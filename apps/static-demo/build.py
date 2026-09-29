"""Assemble la démo statique Carte Blanche, prête à déposer sur Cloudflare Pages.

Tout fonctionne dans le navigateur : catalogue et prix exportés depuis la
configuration du moteur, gabarits générés par le moteur, contrôle PDF simplifié
(pdf.js), feuille SRA3 préimposée générée dans le navigateur (pdf-lib).

    python build.py <dossier_vendor_npm> <dossier_polices_fontsource> [sortie]

Produit `dist/` et `carte-blanche-demo.zip`.
"""

from __future__ import annotations

import glob
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "services" / "print-engine"))

from flux_print.config import (customer_options, list_products, load_item_spec, load_press,  # noqa: E402
                               load_product, media_catalog, media_options, product_data)
from flux_print.production import compute_layout  # noqa: E402
from flux_print.templates import generate_gabarit  # noqa: E402


def export_catalog(gabarits_dir: Path) -> dict:
    press = load_press("xerox-iridesse")
    sheet = press.sheet()
    catalog = media_catalog()
    products = []
    for code in list_products():
        data = product_data(code)
        if "shop" not in data:
            continue
        spec = load_product(code)
        options = customer_options(code)
        entry = {
            "code": code,
            "type": data["type"],
            "shop": data["shop"],
            "options": options,
            "media": [{"code": m, "label": catalog.get(m, {}).get("label", m),
                       "description": catalog.get(m, {}).get("description", "")} for m in media_options(code)],
            "bleed": spec.bleed_mm,
            "safe": spec.safe_mm,
            "templates": {},
        }
        if data["type"] == "custom_deck":
            entry["formats"] = {k: v["trim_mm"] for k, v in data["params"]["formats"].items()}
        else:
            page = spec.pages[0]
            entry["trim"] = [page.trim_w_mm, page.trim_h_mm]
            entry["pageLabels"] = [p.label for p in spec.pages]
            entry["units"] = [[u.recto, u.verso] for u in spec.imposition_units()]
        formats = list(options.get("format", {}).get("choices", {})) or ["default"]
        for fmt in formats:
            overrides = {} if fmt == "default" else {"format": fmt}
            if data["type"] == "custom_deck":
                tspec = load_product(code, template=True, **overrides)
            else:
                tspec = load_item_spec(code, options=overrides)
            name = f"{code}-{fmt}.pdf"
            generate_gabarit(tspec, gabarits_dir / name)
            entry["templates"][fmt] = f"gabarits/{name}"
        products.append(entry)
    products.sort(key=lambda p: p["shop"].get("order", 99))
    return {
        "press": {"name": press.name, "flip": press.flip.value, "profile": press.output.identifier},
        "sheet": {"code": sheet.code, "w": sheet.width_mm, "h": sheet.height_mm, "margin": sheet.margin_mm},
        "products": products,
    }


def main(vendor: str, fonts: str, out: str | None = None) -> None:
    dist = Path(out) if out else HERE / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(HERE / "src", dist)
    (dist / "gabarits").mkdir()
    data = export_catalog(dist / "gabarits")
    (dist / "assets" / "data.js").write_text("export const CATALOG = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")

    v = dist / "assets" / "vendor"
    v.mkdir(parents=True, exist_ok=True)
    pdfjs = glob.glob(f"{vendor}/pdfjs-dist*/package/build")[0]
    shutil.copy(f"{pdfjs}/pdf.min.mjs", v / "pdf.min.mjs")
    shutil.copy(f"{pdfjs}/pdf.worker.min.mjs", v / "pdf.worker.min.mjs")
    shutil.copy(glob.glob(f"{vendor}/pdf-lib*/package/dist/pdf-lib.min.js")[0], v / "pdf-lib.min.js")

    f = dist / "assets" / "fonts"
    f.mkdir(parents=True, exist_ok=True)
    for pattern, name in (("bricolage-grotesque-latin-800-normal.woff2", "display-800.woff2"),
                          ("bricolage-grotesque-latin-600-normal.woff2", "display-600.woff2"),
                          ("hanken-grotesk-latin-400-normal.woff2", "body-400.woff2"),
                          ("hanken-grotesk-latin-500-normal.woff2", "body-500.woff2"),
                          ("hanken-grotesk-latin-600-normal.woff2", "body-600.woff2")):
        shutil.copy(glob.glob(f"{fonts}/**/{pattern}", recursive=True)[0], f / name)

    site = ROOT / "apps" / "site" / "public"
    shutil.copytree(site / "img", dist / "img")
    shutil.copytree(site / "exemples", dist / "exemples")

    zip_path = dist.parent / "carte-blanche-demo.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(dist))
    print(f"{dist} ({sum(p.stat().st_size for p in dist.rglob('*') if p.is_file()) // 1024} Ko) · {zip_path}")


if __name__ == "__main__":
    main(*sys.argv[1:])
