"""Configuration presse/produits, conversion CMJN, PDF/X-4, traits de coupe."""

import shutil
from pathlib import Path

import pikepdf
import pytest
from reportlab.lib.colors import CMYKColor

from conftest import image_reader, make_pdf, make_prepared_pdf, spot
from flux_print.color import CmykConverter, convert_pdf_to_cmyk
from flux_print.config import config_dir, list_products, load_press, load_product
from flux_print.pipeline import prepare_job
from flux_print.preflight import Severity, run_preflight
from flux_print.preflight.scanner import scan_page
from flux_print.production import Job, MarkStyle, compute_layout, impose, is_pdfx4

SYSTEM_CMYK = Path("/usr/share/color/icc/ghostscript/default_cmyk.icc")
needs_icc = pytest.mark.skipif(not SYSTEM_CMYK.is_file(), reason="aucun profil CMJN disponible pour les tests")


@pytest.fixture
def config_with_icc(tmp_path, monkeypatch):
    """Copie de config/ avec un profil CMJN de test à la place de FOGRA51."""
    target = tmp_path / "config"
    shutil.copytree(config_dir(), target)
    shutil.copyfile(SYSTEM_CMYK, target / "icc" / "PSO_Coated_v3.icc")
    monkeypatch.setenv("FLUX_PRINT_CONFIG", str(target))
    return target


# --- Configuration -------------------------------------------------------------

def test_iridesse_press_profile():
    press = load_press("xerox-iridesse")
    sheet = press.sheet("SRA3")
    assert (sheet.width_mm, sheet.height_mm) == (320.0, 450.0)
    assert press.output.identifier == "FOGRA51"
    assert "Gold" in press.specialty_inks


def test_all_configured_products_load_with_3mm_bleed():
    press = load_press("xerox-iridesse")
    for code in list_products():
        spec = load_product(code, press=press)
        assert spec.bleed_mm == 3.0
        assert spec.policy.allowed_spot_names == press.specialty_inks


def test_flat_product_from_config_only():
    spec = load_product("carte-visite-85x55")
    assert spec.page_count == 2 and spec.duplex
    layout = compute_layout(load_press("xerox-iridesse").sheet(), 85, 55, 3)
    assert layout.per_sheet == 21


def test_specialty_ink_is_accepted_other_spots_are_not(tmp_path):
    press = load_press("xerox-iridesse")
    spec = load_product("carte-visite-85x55", press=press)

    def gold(c, i, pw, ph, bleed):
        c.setFillColor(spot("Gold"))
        c.rect(20, 20, 40, 40, stroke=0, fill=1)

    report = run_preflight(make_pdf(tmp_path / "gold.pdf", spec, drawer=gold), spec, measure_ink=False)
    assert report.passed
    assert "color.specialty_ink" in report.codes()


# --- Conversion CMJN -------------------------------------------------------------

@needs_icc
def test_neutral_rgb_becomes_pure_black():
    cv = CmykConverter(SYSTEM_CMYK)
    assert cv.color(0, 0, 0) == (0, 0, 0, 1)
    assert cv.color(0.5, 0.5, 0.5) == (0, 0, 0, 0.5)
    c, m, y, k = cv.color(1, 0, 0)
    assert m > 0.8 and y > 0.8


@needs_icc
def test_pdf_conversion_keeps_boxes_spots_and_black(tmp_path):
    spec = load_product("carte-visite-85x55", press=load_press("xerox-iridesse"))

    def mixed(c, i, pw, ph, bleed):
        c.setFillColorRGB(0.9, 0.2, 0.1)
        c.rect(0, 0, pw, ph, stroke=0, fill=1)
        c.drawImage(image_reader(200, 200), bleed, bleed, 60, 60)
        c.setFillColor(spot("Gold"))
        c.rect(80, 20, 30, 30, stroke=0, fill=1)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Vera", 8)
        c.drawString(80, 80, "Texte")

    src = make_prepared_pdf(tmp_path / "rgb.pdf", spec, drawer=mixed)
    out = tmp_path / "cmyk.pdf"
    report = convert_pdf_to_cmyk(src, out, SYSTEM_CMYK)
    # L'image est partagée entre recto et verso : convertie une seule fois.
    assert report.images_converted == 1 and report.colors_converted >= 2
    with pikepdf.open(out) as pdf:
        assert all("RGB" not in scan_page(p).colorspaces for p in pdf.pages)
        page = pdf.pages[0]
        scan = scan_page(page)
        assert "RGB" not in scan.colorspaces
        assert scan.spot_names == {"Gold"}
        assert "/TrimBox" in page.obj
        ops = pikepdf.unparse_content_stream(pikepdf.parse_content_stream(page)).decode()
        assert "0 0 0 1 k" in ops  # texte noir RVB → 100 % K


@needs_icc
def test_prepare_job_converts_and_passes(tmp_path, config_with_icc):
    press = load_press("xerox-iridesse")
    spec = load_product("carte-visite-85x55", press=press)

    def rgb(c, i, pw, ph, bleed):
        c.setFillColorRGB(0.1, 0.4, 0.9)
        c.rect(0, 0, pw, ph, stroke=0, fill=1)

    out = tmp_path / "ready.pdf"
    report = prepare_job(make_pdf(tmp_path / "in.pdf", spec, drawer=rgb), spec, press, out, measure_ink=False)
    assert report.passed
    assert any("Conversion CMJN" in f for f in report.fixes)
    again = run_preflight(out, spec, measure_ink=False)
    assert "color.rgb" not in again.codes()


# --- Sortie PDF/X-4 et traits de coupe -------------------------------------------

@needs_icc
def test_imposed_sheet_is_pdfx4_on_sra3(tmp_path, config_with_icc):
    press = load_press("xerox-iridesse")
    spec = load_product("jeu-poker-54", press=press)
    job = Job("A", make_prepared_pdf(tmp_path / "a.pdf", spec), spec)
    result = impose([job], tmp_path / "lot.pdf", sheet=press.sheet("SRA3"), output_profile=press.output,
                    press_name=press.name)
    assert result.manifest["pdfx4"] is True
    with pikepdf.open(result.output) as pdf:
        assert is_pdfx4(pdf)
        assert pdf.pdf_version >= "1.6"
        intent = pdf.Root.OutputIntents[0]
        assert str(intent.OutputConditionIdentifier) == "FOGRA51"
        assert intent.DestOutputProfile.read_bytes() == SYSTEM_CMYK.read_bytes()
        for page in pdf.pages:
            assert "/TrimBox" in page.obj and "/BleedBox" in page.obj


def test_without_icc_output_is_flagged_not_pdfx(tmp_path):
    press = load_press("xerox-iridesse")
    missing = press.output.__class__(tmp_path / "absent.icc", "FOGRA51", "")
    spec = load_product("jeu-poker-54", press=press)
    job = Job("A", make_prepared_pdf(tmp_path / "a.pdf", spec), spec)
    result = impose([job], tmp_path / "lot.pdf", output_profile=missing)
    assert result.manifest["pdfx4"] is False


def test_per_piece_marks_leave_room_between_pieces():
    sheet = load_press("xerox-iridesse").sheet()
    edge = compute_layout(sheet, 63.5, 88.9, 3)
    per_piece = compute_layout(sheet, 63.5, 88.9, 3, marks=MarkStyle.PER_PIECE)
    assert edge.per_sheet == 18
    assert per_piece.per_sheet == 16  # l'écart pour les traits coûte 2 poses
    a, b = per_piece.slots[0], per_piece.slots[1]
    assert b.x - (a.x + a.w) > 0


def test_mismatched_file_is_refused_at_imposition(tmp_path):
    cards = load_product("jeu-poker-54")
    business = load_product("carte-visite-85x55")
    pdf = make_prepared_pdf(tmp_path / "cards.pdf", cards)
    with pytest.raises(ValueError):
        impose([Job("X", pdf, business)], tmp_path / "x.pdf")
