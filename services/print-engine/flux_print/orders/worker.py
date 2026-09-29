"""Worker de production : de la ligne de commande déposée au lot SRA3 généré.

Chaque passage (`run_once`) enchaîne trois étapes idempotentes :
1. contrôle   : uploaded → checking → approved | rejected (+ aperçus)
2. préparation : approved (commande payée) → preparing → prepared
3. amalgame   : prepared → batched, lot SRA3 PDF/X-4 + manifeste générés

Plusieurs workers peuvent tourner en parallèle : la réservation des lignes est
atomique côté base (claim_items, FOR UPDATE SKIP LOCKED).
"""

from __future__ import annotations

import json
import logging
import tempfile
import time
import tomllib
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pypdfium2 as pdfium

from ..config import config_dir, load_item_spec, load_press
from ..pipeline import prepare_job
from ..preflight import run_preflight
from ..production import Job, compute_layout, impose
from .batching import BatchingRules, Candidate, plan_batches
from .db import Database
from .files import FileStore

log = logging.getLogger("flux_print.worker")


@dataclass(frozen=True)
class ProductionSettings:
    press: str = "xerox-iridesse"
    sheet: str = "SRA3"
    rules: BatchingRules = field(default_factory=BatchingRules)
    order: str = "cut_stack"
    marks: str = "edge"
    preview_pages: int = 2
    preview_width_px: int = 600
    measure_ink: bool = True

    @classmethod
    def load(cls, path: Path | None = None) -> "ProductionSettings":
        path = path or config_dir() / "production.toml"
        data = tomllib.loads(path.read_text()) if path.is_file() else {}
        b = data.get("batching", {})
        p = data.get("previews", {})
        return cls(
            press=data.get("press", cls.press),
            sheet=data.get("sheet", cls.sheet),
            rules=BatchingRules(
                min_fill_ratio=float(b.get("min_fill_ratio", 0.9)),
                max_wait_hours=float(b.get("max_wait_hours", 24)),
                urgent_days=int(b.get("urgent_days", 2)),
                min_sheets=int(b.get("min_sheets", 1)),
                separators=bool(b.get("separators", True)),
            ),
            order=b.get("order", "cut_stack"),
            marks=b.get("marks", "edge"),
            preview_pages=int(p.get("pages", 2)),
            preview_width_px=int(p.get("width_px", 600)),
        )


class Worker:
    def __init__(self, db: Database, files: FileStore, settings: ProductionSettings | None = None):
        self.db = db
        self.files = files
        self.settings = settings or ProductionSettings.load()
        self.press = load_press(self.settings.press)
        self.sheet = self.press.sheet(self.settings.sheet)
        self._layouts: dict = {}

    def spec_for(self, item: dict):
        return load_item_spec(item["product_code"], press=self.press, media=item["media"],
                              options=item.get("options") or {})

    def layout_for(self, spec):
        page = spec.pages[0]
        key = (page.trim_w_mm, page.trim_h_mm, spec.bleed_mm)
        if key not in self._layouts:
            self._layouts[key] = compute_layout(self.sheet, *key, marks=self.settings.marks)
        return self._layouts[key]

    # --- Boucle ----------------------------------------------------------------------

    def run_once(self, force_batches: bool = False) -> dict[str, int]:
        checked = self.check_uploads()
        prepared = self.prepare_paid()
        requests = self.db.take_batch_requests()
        batches = self.generate_batches(force=force_batches or bool(requests))
        self.db.answer_batch_requests([r["id"] for r in requests], {"batches": batches})
        return {"checked": checked, "prepared": prepared, "batches": len(batches)}

    def run_forever(self, interval_s: float = 30.0) -> None:
        while True:
            try:
                counts = self.run_once()
                if any(counts.values()):
                    log.info("passage : %s", counts)
            except Exception:  # le worker ne s'arrête jamais sur une erreur isolée
                log.exception("passage en erreur")
            time.sleep(interval_s)

    # --- 1. Contrôle --------------------------------------------------------------------

    def check_uploads(self, limit: int = 10) -> int:
        items = self.db.claim_items("uploaded", "checking", limit)
        for item in items:
            try:
                self._check(item)
            except Exception as exc:
                self._fail(item, "check", exc)
        return len(items)

    def _render_design(self, item: dict, tmp: Path) -> Path:
        """Création en ligne : fabrique le PDF du client à partir de son design, puis le range comme un dépôt."""
        from PIL import Image

        from ..config import product_data
        from ..design.render import render_playing_cards, validate_design

        deck = str(product_data(item["product_code"])["params"]["deck"])
        design = validate_design(item["design"], deck)

        def load(path: str) -> Image.Image:
            local = self.files.download("uploads", path, tmp / f"photo-{abs(hash(path))}")
            return Image.open(local)

        pdf = render_playing_cards(design, deck, tmp / "design.pdf", load)
        path = f"rendered/{item['id']}.pdf"
        self.files.upload("uploads", path, pdf, "application/pdf")
        self.db.update_item(item["id"], source_path=path)
        item["source_path"] = path
        return pdf

    def _check(self, item: dict) -> None:
        spec = self.spec_for(item)
        order = self.db.order(item["order_id"])
        with tempfile.TemporaryDirectory(prefix="flux-check-") as tmp:
            if item.get("design") and not item.get("source_path"):
                self._render_design(item, Path(tmp))
            src = self.files.download("uploads", item["source_path"], Path(tmp) / "source.pdf")
            icc = self.press.output.icc_path if self.press.output.available else None
            report = run_preflight(src, spec, measure_ink=self.settings.measure_ink, output_icc=icc)
            previews = self._previews(src, item, order, Path(tmp)) if report.page_count else []
        status = "approved" if report.passed else "rejected"
        self.db.update_item(item["id"], status=status, preflight_report=report.to_dict(), preview_paths=previews)
        errors = [f.code for f in report.findings if f.severity.value == "error"]
        self.db.event("item", item["id"], status, {"errors": errors})

    def _previews(self, pdf: Path, item: dict, order: dict, tmp: Path) -> list[str]:
        owner = str(order["customer_id"]) if order.get("customer_id") else "invites"
        doc = pdfium.PdfDocument(str(pdf))
        pages = list(range(min(self.settings.preview_pages, len(doc))))
        if item.get("design"):
            from ..config import product_data
            from ..design.render import preview_pages, validate_design

            deck = str(product_data(item["product_code"])["params"]["deck"])
            pages = [p - 1 for p in preview_pages(validate_design(item["design"], deck), deck) if p <= len(doc)]
        paths = []
        try:
            for index in pages:
                page = doc[index]
                scale = self.settings.preview_width_px / page.get_width()
                image = page.render(scale=scale).to_pil()
                local = tmp / f"p{index + 1}.png"
                image.save(local, optimize=True)
                path = f"{owner}/{item['order_id']}/{item['id']}/p{index + 1}.png"
                paths.append(self.files.upload("previews", path, local, "image/png"))
        finally:
            doc.close()
        return paths

    # --- 2. Préparation --------------------------------------------------------------------

    def prepare_paid(self, limit: int = 10) -> int:
        items = self.db.claim_items("approved", "preparing", limit, paid_only=True)
        for item in items:
            try:
                self._prepare(item)
            except Exception as exc:
                self._fail(item, "prepare", exc)
        return len(items)

    def _prepare(self, item: dict) -> None:
        spec = self.spec_for(item)
        with tempfile.TemporaryDirectory(prefix="flux-prepare-") as tmp:
            src = self.files.download("uploads", item["source_path"], Path(tmp) / "source.pdf")
            out = Path(tmp) / "prepared.pdf"
            report = prepare_job(src, spec, self.press, out, measure_ink=False)
            if not report.passed:
                raise RuntimeError("Le fichier approuvé ne passe plus le preflight.")
            path = self.files.upload("production", f"items/{item['id']}.pdf", out, "application/pdf")
        self.db.update_item(item["id"], status="prepared", prepared_path=path)
        self.db.event("item", item["id"], "prepared", {"fixes": report.fixes})

    # --- 3. Amalgame ------------------------------------------------------------------------

    def generate_batches(self, force: bool = False) -> list[str]:
        candidates = plan_batches(self.db.prepared_items(), self.spec_for, self.layout_for,
                                  self.settings.rules, force=force)
        return [batch_id for c in candidates if (batch_id := self._generate(c))]

    def _generate(self, candidate: Candidate) -> str | None:
        batch_id = datetime.now(timezone.utc).strftime("L%Y%m%d-%H%M%S-%f")[:-3]
        ids = [str(i["id"]) for i in candidate.items]
        reserved = self.db.reserve_batch(batch_id, candidate.gang_key, candidate.media, self.sheet.code, ids)
        if not reserved:
            self.db.fail_batch(batch_id, "Aucune ligne disponible (prise par un autre worker).")
            return None
        order_numbers = {str(i["id"]): i["order_number"] for i in candidate.items}
        try:
            with tempfile.TemporaryDirectory(prefix="flux-batch-") as tmp:
                jobs = []
                for item in reserved:
                    local = self.files.download("production", item["prepared_path"], Path(tmp) / f"{item['id']}.pdf")
                    label = f"{order_numbers[str(item['id'])]}-{str(item['id'])[:4]}"
                    jobs.append(Job(label, local, candidate.specs[str(item["id"])], int(item["copies"])))
                pdf = Path(tmp) / f"{batch_id}.pdf"
                manifest_file = Path(tmp) / f"{batch_id}.json"
                result = impose(
                    jobs, pdf, sheet=self.sheet, order=self.settings.order,
                    separators=self.settings.rules.separators, batch_id=batch_id,
                    manifest_path=manifest_file, marks=self.settings.marks,
                    output_profile=self.press.output, press_name=self.press.name,
                )
                manifest = result.manifest | {"reason": candidate.reason,
                                              "items": {j.job_id: str(i["id"]) for j, i in zip(jobs, reserved)}}
                manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
                pdf_path = self.files.upload("production", f"batches/{batch_id}.pdf", pdf, "application/pdf")
                self.files.upload("production", f"batches/{batch_id}.json", manifest_file, "application/json")
            self.db.complete_batch(batch_id, pdf_path, manifest)
            self.db.event("batch", batch_id, "generated", {"reason": candidate.reason,
                                                           "sheets": manifest["sheets_count"],
                                                           "fill_ratio": manifest["fill_ratio"]})
            log.info("lot %s : %s, %s", batch_id, result.layout.describe(), candidate.reason)
            return batch_id
        except Exception as exc:
            self.db.fail_batch(batch_id, f"{exc.__class__.__name__}: {exc}")
            self.db.event("batch", batch_id, "failed", {"error": traceback.format_exc()[-2000:]})
            log.exception("lot %s en échec", batch_id)
            return None

    def _fail(self, item: dict, step: str, exc: Exception) -> None:
        log.exception("ligne %s en échec (%s)", item["id"], step)
        self.db.update_item(item["id"], status="failed", error=f"{step}: {exc.__class__.__name__}: {exc}")
        self.db.event("item", item["id"], "failed", {"step": step, "error": traceback.format_exc()[-2000:]})
