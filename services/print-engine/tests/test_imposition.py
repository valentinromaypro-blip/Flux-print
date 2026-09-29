import json

import pikepdf
import pypdfium2 as pdfium
import pytest
from reportlab.lib.colors import CMYKColor

from conftest import make_pdf, make_prepared_pdf
from flux_print.products.playing_cards import FORMATS, build_document_spec
from flux_print.production import SHEET_32X45, Job, SheetOrder, compute_layout, impose
from flux_print.production.imposition import Piece, build_sequence, plan_sheets
from flux_print.units import mm_to_pt


@pytest.mark.parametrize(
    "fmt, expected, rotation",
    [("poker", 18, 90), ("bridge", 18, 90), ("mini", 36, 0), ("tarot", 12, 0)],
)
def test_layout_on_32x45(fmt, expected, rotation):
    f = FORMATS[fmt]
    layout = compute_layout(SHEET_32X45, f.trim_w_mm, f.trim_h_mm, f.bleed_mm)
    assert (layout.per_sheet, layout.rotation) == (expected, rotation)
    for slot in layout.slots:  # tout reste dans la zone utile
        margin = mm_to_pt(SHEET_32X45.margin_mm)
        assert slot.x >= margin - 0.01 and slot.x + slot.w <= SHEET_32X45.width_pt - margin + 0.01
        assert slot.y >= margin - 0.01 and slot.y + slot.h <= SHEET_32X45.height_pt - margin + 0.01


def test_forced_orientation_for_grain_direction():
    f = FORMATS["poker"]
    assert compute_layout(SHEET_32X45, f.trim_w_mm, f.trim_h_mm, f.bleed_mm, rotation=0).per_sheet == 16


def _pieces(n):
    return [Piece("J", str(i), "s", i, None) for i in range(n)]


def test_cut_and_stack_restores_sequence():
    seq = _pieces(50)
    sheets = plan_sheets(seq, per_sheet=18, order=SheetOrder.CUT_STACK)
    assert len(sheets) == 3
    # Pile k = pose k de chaque feuille, feuille 1 en haut ; piles posées dans l'ordre.
    restacked = [sheets[s][k] for k in range(18) for s in range(3) if sheets[s][k] is not None]
    assert restacked == seq


def test_sequential_order():
    sheets = plan_sheets(_pieces(20), per_sheet=18, order=SheetOrder.SEQUENTIAL)
    assert [p.label for p in sheets[1] if p] == ["18", "19"]


def test_sequence_with_separators():
    spec = build_document_spec("poker", "54", "common")
    seq = build_sequence([Job("A", None, spec, copies=2)], separators=True)
    assert len(seq) == 2 * 55
    assert seq[0].kind == "separator" and seq[55].kind == "separator"
    assert (seq[1].recto, seq[1].verso) == (1, 0)  # As de pique, dos commun


@pytest.fixture
def deck_jobs(tmp_path):
    spec = build_document_spec("poker", "54", "common")
    return spec, [Job(f"CMD-{i}", make_prepared_pdf(tmp_path / f"j{i}.pdf", spec), spec) for i in range(3)]


def test_three_decks_fill_nine_sheets_without_separators(tmp_path, deck_jobs):
    spec, jobs = deck_jobs
    result = impose(jobs, tmp_path / "lot.pdf", separators=False, batch_id="T1")
    assert len(result.sheets) == 9
    assert result.fill_ratio == 1.0


def test_imposed_pdf_structure(tmp_path, deck_jobs):
    spec, jobs = deck_jobs
    manifest_path = tmp_path / "lot.json"
    result = impose(jobs, tmp_path / "lot.pdf", manifest_path=manifest_path, batch_id="T2")
    assert len(result.sheets) == 10  # 3 × (54 + séparateur) = 165 pièces / 18
    with pikepdf.open(result.output) as pdf:
        assert len(pdf.pages) == 20  # recto + verso
        w, h = (float(v) for v in pdf.pages[0].mediabox[2:])
        assert (w, h) == (pytest.approx(SHEET_32X45.width_pt), pytest.approx(SHEET_32X45.height_pt))
        forms = [o for o in pdf.objects if isinstance(o, pikepdf.Stream) and o.get("/Subtype") == "/Form"]
        # 3 × 55 pages sources + 3 séparateurs recto/verso : chaque page n'est incorporée qu'une fois.
        assert len(forms) == 3 * 55 + 3 * 2
    manifest = json.loads(manifest_path.read_text())
    assert manifest["pieces"] == 165 and manifest["sheets_count"] == 10
    assert manifest["sheets"][0]["slots"][0]["kind"] == "separator"


def _marker_page(c, i, pw, ph, bleed):
    """Carré rouge dans le coin haut-gauche du format fini."""
    c.setFillColor(CMYKColor(0, 0, 0, 0))
    c.rect(0, 0, pw, ph, stroke=0, fill=1)
    c.setFillColor(CMYKColor(0, 1, 1, 0))
    c.rect(bleed, ph - bleed - mm_to_pt(10), mm_to_pt(10), mm_to_pt(10), stroke=0, fill=1)


def _is_red(image, x_pt, y_pt, height_pt, scale):
    r, g, b = image.getpixel((int(x_pt * scale), int((height_pt - y_pt) * scale)))[:3]
    return r > 200 and g < 80 and b < 80


def test_card_orientation_recto_and_verso(tmp_path):
    spec = build_document_spec("poker", "32", "common")
    job = Job("O", make_prepared_pdf(tmp_path / "o.pdf", spec, drawer=_marker_page), spec)
    result = impose([job], tmp_path / "o-lot.pdf", separators=False, order="sequential")
    slot = result.layout.slots[0]
    assert slot.rotation == 90
    scale, H = 2.0, SHEET_32X45.height_pt
    inside = mm_to_pt(5)
    doc = pdfium.PdfDocument(str(result.output))
    recto = doc[0].render(scale=scale).to_pil()
    verso = doc[1].render(scale=scale).to_pil()
    x0, y0, x1, y1 = slot.trim
    # Carte pivotée de 90° (anti-horaire) : le haut de la carte est à gauche,
    # son coin haut-gauche se retrouve en bas à gauche de l'emplacement.
    assert _is_red(recto, x0 + inside, y0 + inside, H, scale)
    assert not _is_red(recto, x0 + inside, y1 - inside, H, scale)
    # Verso (retournement grand côté) : emplacement en miroir, dos pivoté de 270°,
    # coin haut-gauche du dos en haut à droite de l'emplacement miroir.
    v = slot.verso(SHEET_32X45)
    vx0, vy0, vx1, vy1 = v.trim
    assert _is_red(verso, vx1 - inside, vy1 - inside, H, scale)


def test_incompatible_jobs_are_not_ganged(tmp_path):
    poker = build_document_spec("poker", "54", "common")
    bridge = build_document_spec("bridge", "54", "common")
    jobs = [Job("A", make_pdf(tmp_path / "a.pdf", poker), poker), Job("B", make_pdf(tmp_path / "b.pdf", bridge), bridge)]
    with pytest.raises(ValueError):
        impose(jobs, tmp_path / "x.pdf")
