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


def test_back_fields_match_the_shared_fixture():
    """Même fixture que apps/site/src/lib/backs.test.ts : navigateur et moteur remplissent pareil."""
    from flux_print.design import backs

    for case in json.loads((Path(__file__).parent / "fixtures/back_fields.json").read_text()):
        i = case["input"]
        assert backs.fields(case["model"], i["bg"], i["ink"], i["title"], i["subtitle"], i["logo"], i["tint"], i["photo"]) == case["fields"]


@pytest.mark.skipif(not SITE_CARDS.is_dir(), reason="site absent")
def test_site_uses_the_same_back_templates_and_fonts():
    from flux_print.design import backs

    site = SITE_CARDS / "dos"
    for f in list(backs.DIR.glob("*.svg")) + [backs.DIR / "models.json"]:
        assert (site / f.name).read_bytes() == f.read_bytes(), f.name
    for font in backs.FONTS:
        assert (SITE_CARDS.parent / "fonts/cartes" / Path(font).name).read_bytes() == Path(font).read_bytes()


def test_every_back_model_renders():
    from flux_print.design import backs

    for mid, m in backs.models().items():
        img = backs.render(backs.fill(mid, backs.fields(mid, m["bg"], m["ink"], "Test", "Sous-titre")), 139)
        assert img.size == (139, 190)


def test_company_back_prints_the_logo_full_bleed():
    from flux_print.design.render import render_back

    logo = Image.new("RGBA", (300, 150), (0, 0, 0, 0))
    logo.paste((200, 20, 30, 255), (50, 25, 250, 125))
    back = validate_design({"back": {"template": "logo-centre", "title": "Boulangerie Martin", "subtitle": "Depuis 1987",
                                     "logo": {"path": "logo.png"}}}, "54")["back"]
    img = render_back(back, lambda path: logo)
    assert img.size == (973, 1329)  # 69,5 × 94,9 mm à 14 px/mm : fond perdu compris
    r, g, b, _ = img.getpixel((img.width // 2, int(img.height * 0.42)))
    assert r > 150 and g < 80  # le logo rouge est au centre
    assert img.getpixel((2, 2))[:3] == (255, 255, 255)  # fond blanc jusque dans le fond perdu


def test_logo_pattern_back_requires_a_logo():
    with pytest.raises(DesignError, match="logo"):
        validate_design({"back": {"template": "logo-motif"}}, "54")
    with pytest.raises(DesignError, match="inconnu"):
        validate_design({"back": {"template": "inexistant"}}, "54")
