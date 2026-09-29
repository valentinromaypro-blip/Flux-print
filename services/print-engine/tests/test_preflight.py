import pikepdf
import pytest
from reportlab.lib.colors import CMYKColor

from conftest import default_page, image_reader, make_pdf, spot
from flux_print.preflight import Severity, run_preflight
from flux_print.preflight.scanner import scan_page
from flux_print.preflight.tac import ghostscript_path
from flux_print.templates import generate_gabarit
from flux_print.units import mm_to_pt


def errors(report):
    return {f.code for f in report.by_severity(Severity.ERROR)}


def warnings(report):
    return {f.code for f in report.by_severity(Severity.WARNING)}


def test_conforming_file_passes(tmp_path, spec):
    pdf = make_pdf(tmp_path / "ok.pdf", spec)
    report = run_preflight(pdf, spec, measure_ink=False)
    assert report.passed, report.to_dict()
    assert not warnings(report)


def test_normalization_sets_boxes(tmp_path, spec):
    pdf = make_pdf(tmp_path / "ok.pdf", spec)
    out = tmp_path / "normalized.pdf"
    report = run_preflight(pdf, spec, normalized_output=out, measure_ink=False)
    assert report.fixes
    with pikepdf.open(out) as normalized:
        trim = [float(v) for v in normalized.pages[0].obj["/TrimBox"]]
    bleed = mm_to_pt(spec.bleed_mm)
    assert trim[0] == pytest.approx(bleed, abs=0.01)
    second = run_preflight(out, spec, normalized_output=tmp_path / "again.pdf", measure_ink=False)
    assert second.passed and not second.fixes


def test_missing_bleed(tmp_path, spec):
    pdf = make_pdf(tmp_path / "nobleed.pdf", spec, bleed_mm=0)
    assert "geometry.bleed" in errors(run_preflight(pdf, spec, measure_ink=False))


def test_wrong_page_count(tmp_path, spec):
    pdf = make_pdf(tmp_path / "short.pdf", spec, pages=10)
    assert "pages.count" in errors(run_preflight(pdf, spec, measure_ink=False))


def test_landscape(tmp_path, spec):
    pdf = make_pdf(tmp_path / "landscape.pdf", spec, landscape=True)
    assert "geometry.orientation" in errors(run_preflight(pdf, spec, measure_ink=False))


def test_low_resolution_rgb_image(tmp_path, spec):
    def low_res(c, i, pw, ph, bleed):
        # 100 px sur 1 pouce = 100 ppi
        c.drawImage(image_reader(100, 100), bleed, bleed, 72, 72)

    pdf = make_pdf(tmp_path / "lowres.pdf", spec, overrides={3: low_res})
    report = run_preflight(pdf, spec, measure_ink=False)
    assert "image.resolution" in errors(report)
    assert "color.rgb" in warnings(report)
    finding = next(f for f in report.findings if f.code == "image.resolution")
    assert finding.page == 4
    assert finding.details["ppi"] == pytest.approx(100, abs=0.5)


def test_image_resolution_through_scaled_form(tmp_path, spec):
    def scaled_form(c, i, pw, ph, bleed):
        c.beginForm("logo")
        c.drawImage(image_reader(300, 300, "CMYK"), 0, 0, 72, 72)
        c.endForm()
        c.saveState()
        c.scale(2, 2)  # posé à 2 pouces → 150 ppi
        c.doForm("logo")
        c.restoreState()

    pdf = make_pdf(tmp_path / "form.pdf", spec, pages=1, drawer=scaled_form)
    with pikepdf.open(pdf) as doc:
        scan = scan_page(doc.pages[0])
    assert len(scan.images) == 1
    assert scan.images[0].effective_ppi == pytest.approx(150, abs=0.5)
    assert scan.images[0].colorspace == "CMYK"


def test_non_embedded_font(tmp_path, spec):
    def helvetica(c, i, pw, ph, bleed):
        default_page(c, i, pw, ph, bleed)
        c.setFont("Helvetica", 9)
        c.drawCentredString(pw / 2, ph / 3, "Texte")

    pdf = make_pdf(tmp_path / "font.pdf", spec, overrides={0: helvetica})
    report = run_preflight(pdf, spec, measure_ink=False)
    assert "font.not_embedded" in errors(report)


def test_text_outside_safe_zone(tmp_path, spec):
    def edge_text(c, i, pw, ph, bleed):
        default_page(c, i, pw, ph, bleed)
        c.setFont("Vera", 8)
        c.drawString(bleed + 1, ph / 2, "Bord")  # 1 mm du bord fini, sécurité à 4 mm

    pdf = make_pdf(tmp_path / "safe.pdf", spec, overrides={5: edge_text})
    report = run_preflight(pdf, spec, measure_ink=False)
    finding = next(f for f in report.findings if f.code == "text.safe_zone")
    assert finding.page == 6


def test_hairline(tmp_path, spec):
    def thin(c, i, pw, ph, bleed):
        default_page(c, i, pw, ph, bleed)
        c.setLineWidth(0.1)
        c.line(bleed, ph / 2, pw - bleed, ph / 2)

    pdf = make_pdf(tmp_path / "hairline.pdf", spec, overrides={2: thin})
    assert "content.hairline" in warnings(run_preflight(pdf, spec, measure_ink=False))


def test_unexpected_spot_color(tmp_path, spec):
    def pantone(c, i, pw, ph, bleed):
        c.setFillColor(spot("PANTONE 186 C"))
        c.rect(0, 0, pw, ph, stroke=0, fill=1)

    pdf = make_pdf(tmp_path / "spot.pdf", spec, overrides={0: pantone})
    report = run_preflight(pdf, spec, measure_ink=False)
    assert "color.spot" in errors(report)


def test_gabarit_left_in_file_is_detected(tmp_path, spec):
    gabarit = generate_gabarit(spec, tmp_path / "gabarit.pdf")
    report = run_preflight(gabarit, spec, measure_ink=False)
    codes = errors(report)
    assert "content.guide_marks" in codes
    # Le gabarit lui-même est géométriquement conforme.
    assert not {"pages.count", "geometry.bleed", "geometry.trim_size", "geometry.page_size"} & codes


def test_encrypted_file(tmp_path, spec):
    plain = make_pdf(tmp_path / "plain.pdf", spec, pages=1)
    locked = tmp_path / "locked.pdf"
    with pikepdf.open(plain) as doc:
        doc.save(locked, encryption=pikepdf.Encryption(owner="o", user="u"))
    assert "file.encrypted" in errors(run_preflight(locked, spec, measure_ink=False))


def test_not_a_pdf(tmp_path, spec):
    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"ceci n'est pas un pdf")
    assert "file.unreadable" in errors(run_preflight(junk, spec, measure_ink=False))


@pytest.mark.skipif(ghostscript_path() is None, reason="Ghostscript absent")
def test_total_ink_coverage(tmp_path, spec):
    def heavy(c, i, pw, ph, bleed):
        c.setFillColor(CMYKColor(1, 1, 1, 1))  # 400 %
        c.rect(0, 0, pw, ph, stroke=0, fill=1)

    pdf = make_pdf(tmp_path / "tac.pdf", spec, pages=2, overrides={1: heavy})
    report = run_preflight(pdf, spec)
    tac = [f for f in report.findings if f.code == "ink.tac"]
    assert [f.page for f in tac] == [2]
    assert tac[0].details["tac"] == pytest.approx(400, abs=2)
