"""Figures classiques : la photo du client remplace les deux têtes."""

import json
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from flux_print.design import classic
from flux_print.design.render import DesignError, validate_design

SITE_CARDS = Path(__file__).resolve().parents[3] / "apps/site/public/cartes"


def _photo() -> Image.Image:
    img = Image.new("RGB", (400, 500), (200, 160, 130))
    img.paste((40, 30, 30), (150, 180, 250, 230))
    return img


@pytest.mark.parametrize("style", sorted(classic.STYLES))
def test_face_replaces_both_heads(style):
    width = 480
    plain = classic.court("HK", width).convert("RGB")
    face = classic.court("HK", width, _photo(), {"zoom": 1.5, "x": 0.5, "y": 0.45}, style).convert("RGB")
    k = width / 240
    cx, cy, rx, ry, _ = classic.FACES["HK"]
    top = (round((cx - 8) * k), round((cy - 8) * k), round((cx + 8) * k), round((cy + 8) * k))
    bottom = (plain.width - top[2], plain.height - top[3], plain.width - top[0], plain.height - top[1])
    diff = ImageChops.difference(plain, face)
    assert diff.crop(top).getbbox() and diff.crop(bottom).getbbox()
    # hors de la tête, le dessin est intact
    assert not diff.crop((0, round(150 * k), plain.width, round(186 * k))).getbbox()


def test_every_court_has_a_face_slot():
    for suit in "HDCS":
        for rank in "JQK":
            assert suit + rank in classic.FACES
    assert classic.art_code("JK-2") == "J2" and (classic.DIR / "J2.svg").is_file()


def test_style_is_validated():
    assert validate_design({}, "54")["style"] == "couleur"
    with pytest.raises(DesignError):
        validate_design({"style": "sepia"}, "54")


@pytest.mark.skipif(not SITE_CARDS.is_dir(), reason="site absent")
def test_site_preview_uses_the_same_art():
    assert json.loads((SITE_CARDS / "faces.json").read_text()) == json.loads((classic.DIR / "faces.json").read_text())
    for svg in SITE_CARDS.glob("*.svg"):
        assert svg.read_bytes() == (classic.DIR / svg.name).read_bytes()


def test_cut_out_head_keeps_its_silhouette():
    head = Image.new("RGBA", (300, 380), (0, 0, 0, 0))
    head.paste((210, 170, 140, 255), (60, 40, 240, 340))
    face = classic.court("SQ", 480, head, {"zoom": 1, "x": 0.5, "y": 0.5})
    cx, cy, rx, ry, _ = classic.FACES["SQ"]
    k = 2
    # le coin de la zone du visage reste le dessin d'origine (fond transparent autour de la tête)
    corner = (round((cx - rx + 1) * k), round((cy + ry - 3) * k))
    assert face.getpixel(corner) == classic.court("SQ", 480).getpixel(corner)
    assert face.getpixel((round(cx * k), round(cy * k)))[:3] != classic.court("SQ", 480).getpixel((round(cx * k), round(cy * k)))[:3]
