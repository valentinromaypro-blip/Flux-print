"""Amalgame de commandes et imposition en données variables sur feuille 32 × 45.

Principe :
1. Les commandes compatibles (même `gang_key` : support, format, fond perdu,
   recto/verso) sont mises bout à bout en une séquence de pièces.
2. Un séparateur (pièce imprimée portant le n° de commande et un QR code)
   peut précéder chaque exemplaire pour isoler les commandes au façonnage.
3. La séquence est répartie sur les feuilles :
   - « coupe et empile » (défaut) : pose k de la feuille s = pièce k·N + s.
     Après la coupe, chaque pile est déjà dans l'ordre et il suffit de
     poser les piles les unes sur les autres pour retrouver la séquence :
     les jeux sortent collationnés, sans tri ;
   - « séquentiel » : les feuilles se remplissent l'une après l'autre.
4. Chaque page source n'est incorporée qu'une fois (Form XObject) : un dos
   commun posé 54 fois ne pèse qu'une fois dans le PDF de sortie.
5. Un manifeste JSON décrit chaque pose (feuille, emplacement, commande,
   pièce) pour la traçabilité et le contrôle au façonnage.
"""

from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

import pikepdf
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import CMYKColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from ..products.base import DocumentSpec
from ..units import mm_to_pt, pt_to_mm
from .pdfx import apply_pdfx4
from .sheet import MARK_LENGTH_MM, MARK_OFFSET_MM, SRA3, Layout, MarkStyle, SheetSpec, Slot, compute_layout

REGISTRATION = CMYKColor(1, 1, 1, 1)
BLACK = CMYKColor(0, 0, 0, 1)
_FONT = "FluxVera"
pdfmetrics.registerFont(TTFont(_FONT, "Vera.ttf"))  # police libre livrée avec ReportLab, incorporée


class SheetOrder(str, Enum):
    LANES = "lanes"            # piles alignées : hauteur optimisée, chaque pile n'appartient qu'à un seul jeu
    DECK_STACK = "deck_stack"  # pile = jeu : autant de feuilles que de cartes, chaque pose = un jeu complet
    CUT_STACK = "cut_stack"    # coupe et empile compact : le moins de feuilles, piles à reposer dans l'ordre
    SEQUENTIAL = "sequential"


@dataclass(frozen=True)
class Job:
    """Une ligne de commande validée : PDF conforme (sortie du preflight) + spec."""

    job_id: str
    pdf_path: Path
    spec: DocumentSpec
    copies: int = 1


@dataclass(frozen=True)
class Piece:
    job_id: str
    label: str
    source: str  # clé du PDF source
    recto: int
    verso: int | None
    kind: str = "unit"  # "unit" | "separator"


@dataclass
class BatchResult:
    batch_id: str
    layout: Layout
    order: SheetOrder
    sheets: list[list[Piece | None]]
    pieces: int
    output: Path
    manifest: dict = field(default_factory=dict)
    book_length: int = 0  # mode pile = jeu : feuilles par livre (= pièces d'un jeu)

    @property
    def fill_ratio(self) -> float:
        return self.pieces / (len(self.sheets) * self.layout.per_sheet) if self.sheets else 0.0


def build_decks(jobs: list[Job], separators: bool = True) -> list[list[Piece]]:
    """Un élément par exemplaire : [séparateur éventuel] + ses pièces, dans l'ordre."""
    decks: list[list[Piece]] = []
    for job in jobs:
        units = job.spec.imposition_units()
        for copy in range(job.copies):
            deck = []
            if separators:
                deck.append(Piece(job.job_id, f"Séparateur {copy + 1}/{job.copies}", f"sep:{job.job_id}", 2 * copy,
                                  2 * copy + 1 if job.spec.duplex else None, kind="separator"))
            deck += [Piece(job.job_id, u.label, f"job:{job.job_id}", u.recto, u.verso) for u in units]
            decks.append(deck)
    return decks


def build_sequence(jobs: list[Job], separators: bool = True) -> list[Piece]:
    return [piece for deck in build_decks(jobs, separators) for piece in deck]


def plan_sheets(sequence: list[Piece], per_sheet: int, order: SheetOrder) -> list[list[Piece | None]]:
    if not sequence:
        return []
    n_sheets = math.ceil(len(sequence) / per_sheet)
    sheets: list[list[Piece | None]] = [[None] * per_sheet for _ in range(n_sheets)]
    for position, piece in enumerate(sequence):
        if order is SheetOrder.CUT_STACK:
            slot, sheet = divmod(position, n_sheets)
        else:
            sheet, slot = divmod(position, per_sheet)
        sheets[sheet][slot] = piece
    return sheets


def plan_deck_stack(decks: list[list[Piece]], per_sheet: int) -> tuple[list[list[Piece | None]], int]:
    """Pile = jeu : la feuille n porte la carte n de chacun des jeux (un jeu par pose).
    Au-delà de `per_sheet` jeux, un deuxième « livre » de feuilles suit le premier.
    Renvoie les feuilles et la longueur d'un livre (en feuilles)."""
    length = max(len(d) for d in decks)
    sheets: list[list[Piece | None]] = []
    for start in range(0, len(decks), per_sheet):
        book = decks[start:start + per_sheet]
        for n in range(length):
            sheets.append([book[k][n] if k < len(book) and n < len(book[k]) else None for k in range(per_sheet)])
    return sheets, length


@dataclass(frozen=True)
class LanePlan:
    """Plan « piles alignées » : `sheets_per_book` feuilles par coupe, et pour chaque jeu
    (dans l'ordre) son livre et ses piles consécutives."""
    sheets_per_book: int
    books: int
    placement: list[tuple[int, int, int]]  # (livre, première pile, nombre de piles) par jeu

    @property
    def sheets(self) -> int:
        return self.books * self.sheets_per_book

    @property
    def merges(self) -> int:
        return sum(n - 1 for _, _, n in self.placement)


def lane_plan(lengths: list[int], per_sheet: int, sheets_per_book: int) -> LanePlan:
    """Range les jeux dans des livres de `per_sheet` piles : un jeu de L pièces prend ⌈L/N⌉ piles
    consécutives du même livre (premier livre où elles tiennent, dans l'ordre des commandes)."""
    free: list[int] = []  # prochaine pile libre de chaque livre
    placement = []
    for length in lengths:
        lanes = math.ceil(length / sheets_per_book)
        if lanes > per_sheet:
            raise ValueError("Jeu trop long pour la hauteur de coupe choisie.")
        book = next((b for b, f in enumerate(free) if f + lanes <= per_sheet), None)
        if book is None:
            free.append(0)
            book = len(free) - 1
        placement.append((book, free[book], lanes))
        free[book] += lanes
    return LanePlan(sheets_per_book, len(free), placement)


def best_lane_plan(lengths: list[int], per_sheet: int, max_sheets: int = 100,
                   sheet_cost: float = 0.25, merge_cost: float = 0.03, cut_cost: float = 1.5) -> LanePlan:
    """Hauteur de livre la moins chère : feuilles imprimées + coupes au massicot (une par livre)
    + piles à reposer l'une sur l'autre. À coût égal, la plus haute (moins de manipulations)."""
    longest = max(lengths)
    lower = max(1, math.ceil(longest / per_sheet))
    best: LanePlan | None = None
    best_cost = 0.0
    for n in range(lower, min(longest, max_sheets) + 1):
        plan = lane_plan(lengths, per_sheet, n)
        cost = plan.sheets * sheet_cost + plan.merges * merge_cost + plan.books * cut_cost
        if best is None or cost <= best_cost + 1e-9:
            best, best_cost = plan, cost
    assert best is not None
    return best


def plan_lanes(decks: list[list[Piece]], per_sheet: int, plan: LanePlan) -> list[list[Piece | None]]:
    n = plan.sheets_per_book
    sheets: list[list[Piece | None]] = [[None] * per_sheet for _ in range(plan.sheets)]
    for deck, (book, first, _) in zip(decks, plan.placement):
        for i, piece in enumerate(deck):
            lane, row = divmod(i, n)
            sheets[book * n + row][first + lane] = piece
    return sheets


def impose(
    jobs: list[Job],
    output: str | Path,
    sheet: SheetSpec = SRA3,
    order: SheetOrder | str = SheetOrder.CUT_STACK,
    separators: bool = True,
    rotation: int | None = None,
    batch_id: str | None = None,
    max_cut_sheets: int = 100,
    sheet_cost: float = 0.25,
    merge_cost: float = 0.03,
    cut_cost: float = 1.5,
    manifest_path: str | Path | None = None,
    marks: MarkStyle | str = MarkStyle.EDGE,
    output_profile=None,
    press_name: str = "",
) -> BatchResult:
    """Impose un lot. `output_profile` (config.OutputProfile) : si fourni et
    son fichier ICC présent, le PDF de sortie est finalisé en PDF/X-4."""
    if not jobs:
        raise ValueError("Aucune commande à imposer.")
    keys = {job.spec.gang_key for job in jobs}
    if len(keys) > 1:
        raise ValueError(f"Commandes non amalgamables (support/format/mode différents) : {sorted(map(str, keys))}")
    spec = jobs[0].spec
    if len({(p.trim_w_mm, p.trim_h_mm) for p in spec.pages}) != 1:
        raise NotImplementedError("Imposition de pièces de formats mixtes non prise en charge.")

    for job in jobs:
        _check_job_matches_spec(job)

    order = SheetOrder(order)
    output = Path(output)
    batch_id = batch_id or datetime.now(timezone.utc).strftime("L%Y%m%d-%H%M%S")
    page = spec.pages[0]
    layout = compute_layout(sheet, page.trim_w_mm, page.trim_h_mm, spec.bleed_mm, rotation=rotation, marks=marks)
    decks = build_decks(jobs, separators)
    sequence = [piece for deck in decks for piece in deck]
    lanes: LanePlan | None = None
    if order is SheetOrder.LANES:
        lanes = best_lane_plan([len(d) for d in decks], layout.per_sheet, max_cut_sheets, sheet_cost, merge_cost, cut_cost)
        sheets, book_length = plan_lanes(decks, layout.per_sheet, lanes), lanes.sheets_per_book
    elif order is SheetOrder.DECK_STACK:
        sheets, book_length = plan_deck_stack(decks, layout.per_sheet)
    else:
        sheets, book_length = plan_sheets(sequence, layout.per_sheet, order), 0
    duplex = spec.duplex

    condition = output_profile.identifier if output_profile is not None else "sans profil"
    marks_pdf = _marks(layout, sheets, duplex, batch_id, spec, f"{press_name} · {condition}".strip(" ·"))
    sources: dict[str, pikepdf.Pdf] = {f"job:{j.job_id}": pikepdf.open(j.pdf_path) for j in jobs}
    if separators:
        for job in jobs:
            sources[f"sep:{job.job_id}"] = pikepdf.open(io.BytesIO(_separator_pdf(job, duplex)))

    try:
        with pikepdf.open(io.BytesIO(marks_pdf)) as out:
            forms: dict[tuple[str, int], tuple[pikepdf.Name, pikepdf.Object]] = {}

            def form(source: str, index: int) -> tuple[pikepdf.Name, pikepdf.Object]:
                key = (source, index)
                if key not in forms:
                    src_page = sources[source].pages[index]
                    xobj = out.copy_foreign(src_page.as_form_xobject())
                    # as_form_xobject rogne à la TrimBox : on rétablit le fond perdu.
                    xobj["/BBox"] = pikepdf.Array(_bleed_rect(src_page, spec))
                    forms[key] = (pikepdf.Name(f"/Fx{len(forms)}"), xobj)
                return forms[key]

            for s, pieces in enumerate(sheets):
                sides = [("recto", out.pages[s * (2 if duplex else 1)])]
                if duplex:
                    sides.append(("verso", out.pages[2 * s + 1]))
                for side, sheet_page in sides:
                    ops = []
                    used: dict[pikepdf.Name, pikepdf.Object] = {}
                    for slot, piece in zip(layout.slots, pieces):
                        if piece is None:
                            continue
                        index = piece.recto if side == "recto" else piece.verso
                        if index is None:
                            continue
                        target = slot if side == "recto" else slot.verso(layout.sheet)
                        name, xobj = form(piece.source, index)
                        used[name] = xobj
                        matrix = _placement(xobj, target)
                        ops.append(f"q {' '.join(f'{v:.4f}' for v in matrix)} cm {name} Do Q")
                    if not ops:
                        continue
                    if "/Resources" not in sheet_page.obj:
                        sheet_page.obj["/Resources"] = pikepdf.Dictionary()
                    resources = sheet_page.obj["/Resources"]
                    xobjects = pikepdf.Dictionary(dict(resources.get("/XObject", pikepdf.Dictionary()).items()))
                    for name, xobj in used.items():
                        xobjects[name] = xobj
                    resources["/XObject"] = xobjects
                    # Contenu en premier, repères par-dessus.
                    sheet_page.contents_add(out.make_stream("\n".join(ops).encode()), prepend=True)
            title = f"Lot {batch_id} — {layout.describe()}"
            out.docinfo["/Title"] = title
            pdfx = output_profile is not None and output_profile.available
            if pdfx:
                apply_pdfx4(out, output_profile.icc_path, output_profile.identifier, output_profile.condition,
                            output_profile.registry, title=title)
            out.save(output, min_version="1.6")
    finally:
        for pdf in sources.values():
            pdf.close()

    result = BatchResult(batch_id, layout, order, sheets, len(sequence), output, book_length=book_length)
    result.manifest = _manifest(result, jobs, spec, duplex)
    if lanes is not None:
        result.manifest["decks"] = _lane_decks(decks, lanes)
    result.manifest["pdfx4"] = pdfx
    result.manifest["output_condition"] = condition
    result.manifest["press"] = press_name
    if manifest_path is not None:
        Path(manifest_path).write_text(json.dumps(result.manifest, ensure_ascii=False, indent=2))
    return result


def _check_job_matches_spec(job: Job) -> None:
    """Dernier garde-fou : le fichier doit correspondre au produit imposé."""
    spec = job.spec
    tol = spec.policy.geometry_tolerance_mm
    with pikepdf.open(job.pdf_path) as pdf:
        if len(pdf.pages) != spec.page_count:
            raise ValueError(f"{job.job_id} : {len(pdf.pages)} pages, {spec.page_count} attendues pour {spec.code}.")
        for number, (page, page_spec) in enumerate(zip(pdf.pages, spec.pages), start=1):
            if "/TrimBox" not in page.obj:
                raise ValueError(f"{job.job_id} p.{number} : pas de TrimBox, fichier non préparé (flux-print prepare).")
            x0, y0, x1, y1 = (float(v) for v in page.obj["/TrimBox"])
            w, h = pt_to_mm(abs(x1 - x0)), pt_to_mm(abs(y1 - y0))
            if int(page.obj.get("/Rotate", 0)) % 180:
                w, h = h, w
            if abs(w - page_spec.trim_w_mm) > tol or abs(h - page_spec.trim_h_mm) > tol:
                raise ValueError(f"{job.job_id} p.{number} : format fini {w:.1f} × {h:.1f} mm, "
                                 f"attendu {page_spec.trim_w_mm} × {page_spec.trim_h_mm} mm.")


def _bleed_rect(page: pikepdf.Page, spec: DocumentSpec) -> list[float]:
    bleed = mm_to_pt(spec.bleed_mm)
    media = [float(v) for v in page.mediabox]
    if "/TrimBox" in page.obj:
        x0, y0, x1, y1 = (float(v) for v in page.obj["/TrimBox"])
        rect = [x0 - bleed, y0 - bleed, x1 + bleed, y1 + bleed]
        return [max(rect[0], media[0]), max(rect[1], media[1]), min(rect[2], media[2]), min(rect[3], media[3])]
    return media  # fichier normalisé par le preflight : ne devrait pas arriver


def _placement(xobj: pikepdf.Object, slot: Slot) -> tuple[float, ...]:
    """Matrice qui pose le rectangle fond perdu de la forme dans l'emplacement."""
    fm = [float(v) for v in xobj.get("/Matrix", [1, 0, 0, 1, 0, 0])]
    bx0, by0, bx1, by1 = (float(v) for v in xobj["/BBox"])
    corners = [(bx0, by0), (bx1, by0), (bx0, by1), (bx1, by1)]
    shown = [(fm[0] * x + fm[2] * y + fm[4], fm[1] * x + fm[3] * y + fm[5]) for x, y in corners]
    dx0, dy0 = min(p[0] for p in shown), min(p[1] for p in shown)
    dx1, dy1 = max(p[0] for p in shown), max(p[1] for p in shown)
    w, h = dx1 - dx0, dy1 - dy0
    cos, sin = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[slot.rotation]
    rotated = [(cos * x - sin * y, sin * x + cos * y) for x, y in ((0, 0), (w, 0), (0, h), (w, h))]
    rx0, ry0 = min(p[0] for p in rotated), min(p[1] for p in rotated)
    rw, rh = max(p[0] for p in rotated) - rx0, max(p[1] for p in rotated) - ry0
    # Centrage dans l'emplacement (absorbe les écarts ≤ tolérance du preflight).
    ex = slot.x + (slot.w - rw) / 2 - rx0
    ey = slot.y + (slot.h - rh) / 2 - ry0
    # translate(-dx0, -dy0) puis rotation puis translate(ex, ey)
    return (cos, sin, -sin, cos, -dx0 * cos + dy0 * sin + ex, -dx0 * sin - dy0 * cos + ey)


def _marks(layout: Layout, sheets: list[list[Piece | None]], duplex: bool, batch_id: str, spec: DocumentSpec,
           press_info: str) -> bytes:
    n_sheets = len(sheets)
    sheet = layout.sheet
    W, H = sheet.width_pt, sheet.height_pt
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setTitle(f"Lot {batch_id}")
    xs = sorted({round(v, 3) for s in layout.slots for v in (s.trim[0], s.trim[2])})
    ys = sorted({round(v, 3) for s in layout.slots for v in (s.trim[1], s.trim[3])})
    gx0, gx1 = min(s.x for s in layout.slots), max(s.x + s.w for s in layout.slots)
    gy0, gy1 = min(s.y for s in layout.slots), max(s.y + s.h for s in layout.slots)
    offset, length = mm_to_pt(MARK_OFFSET_MM), mm_to_pt(MARK_LENGTH_MM)

    for s in range(n_sheets):
        # Recto : traits de coupe, marques de découpe numérique, identification.
        c.setStrokeColor(REGISTRATION)
        c.setLineWidth(0.25)
        if layout.marks is MarkStyle.EDGE:
            for x in xs:
                c.line(x, gy1 + offset, x, min(gy1 + offset + length, H))
                c.line(x, gy0 - offset, x, max(gy0 - offset - length, 0))
            for y in ys:
                c.line(gx0 - offset, y, max(gx0 - offset - length, 0), y)
                c.line(gx1 + offset, y, min(gx1 + offset + length, W), y)
        else:
            occupied = [slot for slot, piece in zip(layout.slots, sheets[s]) if piece is not None]
            _per_piece_marks(c, occupied, length)
        c.setFillColor(BLACK)
        if sheet.cutter_marks:
            size, inset = mm_to_pt(3), mm_to_pt(sheet.margin_mm / 2) - mm_to_pt(1.5)
            for x, y in ((inset, inset), (W - inset - size, inset), (inset, H - inset - size),
                         (W - inset - size, H - inset - size)):
                c.rect(x, y, size, size, stroke=0, fill=1)
        _sheet_label(c, sheet, f"{batch_id}|{s + 1}|R", f"Lot {batch_id} · feuille {s + 1}/{n_sheets} · RECTO · "
                     f"{spec.media} · {layout.describe()} · {press_info}")
        c.showPage()
        if duplex:
            c.setFillColor(BLACK)
            _sheet_label(c, sheet, f"{batch_id}|{s + 1}|V", f"Lot {batch_id} · feuille {s + 1}/{n_sheets} · VERSO")
            c.showPage()
    c.save()
    return buf.getvalue()


def _per_piece_marks(c: canvas.Canvas, slots: list[Slot], length: float) -> None:
    """Traits de coupe aux quatre coins de chaque pièce posée, hors fond perdu."""
    for slot in slots:
        tx0, ty0, tx1, ty1 = slot.trim
        bx0, by0, bx1, by1 = slot.x, slot.y, slot.x + slot.w, slot.y + slot.h
        for y in (ty0, ty1):
            c.line(bx0, y, bx0 - length, y)
            c.line(bx1, y, bx1 + length, y)
        for x in (tx0, tx1):
            c.line(x, by0, x, by0 - length)
            c.line(x, by1, x, by1 + length)


def _sheet_label(c: canvas.Canvas, sheet: SheetSpec, code: str, text: str) -> None:
    qr_size = mm_to_pt(sheet.margin_mm - 3)
    x = mm_to_pt(sheet.margin_mm)
    y = mm_to_pt(1.5)
    _qr(c, code, x, y, qr_size)
    c.setFont(_FONT, 6)
    c.drawString(x + qr_size + mm_to_pt(2), y + qr_size / 2 - 2, text)


def _qr(c: canvas.Canvas, value: str, x: float, y: float, size: float) -> None:
    widget = QrCodeWidget(value, barFillColor=BLACK, barStrokeColor=BLACK)
    x0, y0, x1, y1 = widget.getBounds()
    drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, c, x, y)


def _separator_pdf(job: Job, duplex: bool) -> bytes:
    """Pièces séparatrices : une par exemplaire, recto (et verso) identifiés."""
    spec = job.spec
    page = spec.pages[0]
    bleed = mm_to_pt(spec.bleed_mm)
    tw, th = mm_to_pt(page.trim_w_mm), mm_to_pt(page.trim_h_mm)
    pw, ph = tw + 2 * bleed, th + 2 * bleed
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(pw, ph))
    for copy in range(job.copies):
        for side in (("RECTO", "VERSO") if duplex else ("RECTO",)):
            # Carte d'identification lisible d'un coup d'œil sur le dessus de la pile (fond clair : peu d'encre)
            order = job.job_id.rsplit("-", 1)[0] if job.job_id.count("-") >= 2 else job.job_id
            c.setFillColor(CMYKColor(0, 0, 0, 0.06))
            c.rect(0, 0, pw, ph, stroke=0, fill=1)
            c.setFillColor(BLACK)
            c.setFont(_FONT, 7)
            c.drawCentredString(pw / 2, ph - bleed - mm_to_pt(9), "JEU POUR LA COMMANDE")
            size = min(26, 26 * mm_to_pt(52) / max(1, pdfmetrics.stringWidth(order, _FONT, 26)))
            c.setFont(_FONT, size)
            c.drawCentredString(pw / 2, ph - bleed - mm_to_pt(20), order)
            c.setFont(_FONT, 13)
            c.drawCentredString(pw / 2, ph - bleed - mm_to_pt(29),
                                f"Jeu {copy + 1} / {job.copies}" if job.copies > 1 else "Jeu unique")
            c.setFont(_FONT, 6.5)
            c.drawCentredString(pw / 2, ph - bleed - mm_to_pt(35), f"{len(spec.imposition_units())} cartes · {job.job_id}")
            qr = min(tw, th) * 0.38
            _qr(c, f"{job.job_id}|{copy + 1}", (pw - qr) / 2, bleed + mm_to_pt(9), qr)
            c.setFont(_FONT, 5)
            c.drawCentredString(pw / 2, bleed + mm_to_pt(4.5), f"{side} · à retirer avant mise en étui")
            c.showPage()
    c.setPageSize((pw, ph))
    c.save()
    pdf = pikepdf.open(io.BytesIO(buf.getvalue()))
    with pdf:
        for p in pdf.pages:
            p.obj["/TrimBox"] = pikepdf.Array([bleed, bleed, bleed + tw, bleed + th])
        out = io.BytesIO()
        pdf.save(out)
    return out.getvalue()


def _lane_decks(decks: list[list[Piece]], plan: LanePlan) -> list[dict]:
    """Pour la fiche de lot : chaque jeu, son livre et ses piles, dans l'ordre de ramassage."""
    copies: dict[str, int] = {}
    out = []
    for deck, (book, first, lanes) in zip(decks, plan.placement):
        job = deck[0].job_id
        copies[job] = copies.get(job, 0) + 1
        out.append({"job": job, "copy": copies[job], "book": book + 1, "stacks": list(range(first + 1, first + lanes + 1)),
                    "cards": sum(1 for p in deck if p.kind == "unit")})
    return out


def _manifest(result: BatchResult, jobs: list[Job], spec: DocumentSpec, duplex: bool) -> dict:
    layout = result.layout
    n = len(result.sheets)
    stacks = []
    if result.order in (SheetOrder.DECK_STACK, SheetOrder.LANES):
        book_len = result.book_length
        for b in range(0, n, book_len):
            for k in range(layout.per_sheet):
                items = [result.sheets[s][k] for s in range(b, min(n, b + book_len)) if result.sheets[s][k] is not None]
                if items:
                    units = [p for p in items if p.kind == "unit"]
                    stacks.append({"book": b // book_len + 1, "stack": k + 1, "job": items[0].job_id, "count": len(items),
                                   "first": f"{items[0].job_id} · {items[0].label}", "last": f"{items[-1].job_id} · {items[-1].label}",
                                   "cards": len(units)})
    elif result.order is SheetOrder.CUT_STACK:
        for k in range(layout.per_sheet):
            items = [result.sheets[s][k] for s in range(n) if result.sheets[s][k] is not None]
            if items:
                stacks.append({
                    "stack": k + 1,
                    "count": len(items),
                    "first": f"{items[0].job_id} · {items[0].label}",
                    "last": f"{items[-1].job_id} · {items[-1].label}",
                })
    return {
        "batch_id": result.batch_id,
        "sheet": {"code": layout.sheet.code, "width_mm": layout.sheet.width_mm, "height_mm": layout.sheet.height_mm,
                  "flip": layout.sheet.flip.value},
        "media": spec.media,
        "duplex": duplex,
        "layout": {"cols": layout.cols, "rows": layout.rows, "rotation": layout.rotation,
                   "per_sheet": layout.per_sheet, "description": layout.describe()},
        "order": result.order.value,
        "book_sheets": result.book_length or None,
        "sheets_count": n,
        "impressions": n * (2 if duplex else 1),
        "pieces": result.pieces,
        "fill_ratio": round(result.fill_ratio, 4),
        "jobs": [{"job_id": j.job_id, "copies": j.copies, "units": len(j.spec.imposition_units())} for j in jobs],
        "slots": [{"slot": s.index + 1, "trim_mm": [round(pt_to_mm(v), 2) for v in s.trim]} for s in layout.slots],
        "sheets": [
            {"sheet": i + 1, "slots": [
                {"slot": k + 1, "job": p.job_id, "piece": p.label, "kind": p.kind}
                for k, p in enumerate(pieces) if p is not None]}
            for i, pieces in enumerate(result.sheets)
        ],
        "stacks": stacks,
        "stacking_instructions": (
            "Couper chaque livre de feuilles d'un seul coup : chaque pile est un jeu complet et trié. "
            "La fiche de lot indique la commande de chaque pile."
            if result.order is SheetOrder.DECK_STACK else
            "Couper chaque livre d'un seul coup. Chaque pile n'appartient qu'à un seul jeu : pour un jeu "
            "sur plusieurs piles, poser la première pile sur la suivante, dans l'ordre de la fiche de lot."
            if result.order is SheetOrder.LANES else
            "Après coupe, poser la pile 1 sur la pile 2, puis l'ensemble sur la pile 3, etc. : "
            "la séquence des commandes est reconstituée, séparateurs compris."
            if result.order is SheetOrder.CUT_STACK else "Trier les pièces par pose après coupe."
        ),
    }
