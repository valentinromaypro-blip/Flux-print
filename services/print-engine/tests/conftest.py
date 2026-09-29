"""Fabrique de PDF de test pour le preflight."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Callable

import numpy as np
import pytest
from PIL import Image
from reportlab.lib.colors import CMYKColor, CMYKColorSep
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from flux_print.products.playing_cards import build_document_spec
from flux_print.units import mm_to_pt

pdfmetrics.registerFont(TTFont("Vera", "Vera.ttf"))  # police livrée avec ReportLab → incorporée

PageDrawer = Callable[[canvas.Canvas, int, float, float, float], None]


@pytest.fixture
def spec():
    return build_document_spec("poker", "32", "common")


def default_page(c: canvas.Canvas, index: int, pw: float, ph: float, bleed: float) -> None:
    """Page conforme : aplat CMJN à fond perdu + texte incorporé centré."""
    c.setFillColor(CMYKColor(0.1, 0.6, 0.0, 0.1))
    c.rect(0, 0, pw, ph, stroke=0, fill=1)
    c.setFillColor(CMYKColor(0, 0, 0, 1))
    c.setFont("Vera", 9)
    c.drawCentredString(pw / 2, ph / 2, f"Carte {index + 1}")


def make_pdf(
    path: Path,
    spec,
    *,
    pages: int | None = None,
    bleed_mm: float | None = None,
    landscape: bool = False,
    drawer: PageDrawer = default_page,
    overrides: dict[int, PageDrawer] | None = None,
) -> Path:
    bleed = mm_to_pt(spec.bleed_mm if bleed_mm is None else bleed_mm)
    count = spec.page_count if pages is None else pages
    tw, th = mm_to_pt(spec.pages[0].trim_w_mm), mm_to_pt(spec.pages[0].trim_h_mm)
    pw, ph = tw + 2 * bleed, th + 2 * bleed
    if landscape:
        pw, ph = ph, pw
    c = canvas.Canvas(str(path), pagesize=(pw, ph))
    for i in range(count):
        (overrides or {}).get(i, drawer)(c, i, pw, ph, bleed)
        c.showPage()
    c.save()
    return path


def image_reader(width_px: int, height_px: int, mode: str = "RGB") -> ImageReader:
    rng = np.random.default_rng(0)
    channels = {"RGB": 3, "CMYK": 4}[mode]
    arr = rng.integers(0, 255, size=(height_px, width_px, channels), dtype=np.uint8)
    img = Image.fromarray(arr, mode=mode)
    if mode == "CMYK":
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        buf.seek(0)
        return ImageReader(buf)
    return ImageReader(img)


def spot(name: str) -> CMYKColorSep:
    return CMYKColorSep(0, 0.5, 1, 0, spotName=name)


def make_prepared_pdf(path: Path, spec, **kwargs) -> Path:
    """PDF passé par le preflight avec normalisation des boîtes, comme en production."""
    from flux_print.preflight import run_preflight

    raw = make_pdf(path.with_suffix(".raw.pdf"), spec, **kwargs)
    report = run_preflight(raw, spec, normalized_output=path, measure_ink=False)
    assert report.passed, report.to_dict()
    return path
