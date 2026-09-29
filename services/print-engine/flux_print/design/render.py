"""Création en ligne : un « design » client devient le PDF d'impression.

Design d'un jeu de cartes (JSON stocké sur la ligne de commande) :

    {
      "back":   {"template": "logo-centre", "color": "#FFFFFF", "ink": "#16161A", "title": "Boulangerie Martin",
                 "subtitle": "Depuis 1987", "logo": {"path": "sessions/…/photos/….png", "tint": false},
                 "photo": {"path": "sessions/…/photos/….jpg", "zoom": 1.2, "x": 0.5, "y": 0.4}},
      "style":  "couleur",            # traitement des visages : couleur ou gravure (bleu du dessin)
      "courts": {"H-K": {"photo": {"path": "…", "zoom": 1.1, "x": 0.5, "y": 0.52}}, …}
    }

Les faces sont les cartes classiques (classic.py) ; sur chaque figure choisie, la
photo du client remplace les deux têtes. Photo détourée (PNG transparent) : zoom 0,5 à 4
et décalage x, y autour de la tête d'origine ; photo ordinaire : recadrage (zoom ≥ 1).

Le PDF sort au format du gabarit (dos commun, puis les faces dans l'ordre),
avec 3 mm de fond perdu : il passe ensuite par le même contrôle que les
fichiers déposés.
"""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Callable

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from ..products.playing_cards import DECKS
from ..units import mm_to_pt
from . import cardart as art
from . import backs, classic

COURTS = {"J": ("V", "jack"), "Q": ("D", "queen"), "K": ("R", "king")}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PhotoLoader = Callable[[str], Image.Image]
FRONT_PX = round(art.OUT_PX_PER_MM * 63.5)
BACK_RATIO = 69.5 / 94.9  # photo de dos : pleine page, fond perdu compris (largeur / hauteur)


class DesignError(ValueError):
    pass


def _rgb(value: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
    if not value:
        return default
    if not HEX.match(value):
        raise DesignError(f"Couleur invalide : {value}")
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def _photo_spec(spec) -> dict | None:
    if spec is None:
        return None
    if not isinstance(spec, dict) or not isinstance(spec.get("path"), str):
        raise DesignError("Photo invalide.")
    for key, lo, hi in (("zoom", 0.5, 4), ("x", 0, 1), ("y", 0, 1)):
        if key in spec and not (isinstance(spec[key], (int, float)) and lo <= spec[key] <= hi):
            raise DesignError(f"Recadrage invalide ({key}).")
    return spec


def validate_design(design: dict, deck_code: str) -> dict:
    """Contrôle la forme du design (longueurs, couleurs, cartes existantes). Renvoie le design nettoyé."""
    if not isinstance(design, dict):
        raise DesignError("Design invalide.")
    back = design.get("back") or {}
    template = back.get("template") or "classique"
    if template not in backs.models():
        raise DesignError(f"Modèle de dos inconnu : {template}")
    logo = back.get("logo")
    if logo is not None and (not isinstance(logo, dict) or not isinstance(logo.get("path"), str)):
        raise DesignError("Logo invalide.")
    clean_back = {
        "template": template,
        "color": back.get("color") or backs.models()[template]["bg"],
        "ink": back.get("ink") or backs.models()[template]["ink"],
        "title": str(back.get("title") or "")[:backs.TITLE_MAX],
        "subtitle": str(back.get("subtitle") or "")[:backs.SUBTITLE_MAX],
        "photo": _photo_spec(back.get("photo")),
        "logo": {"path": logo["path"], "tint": bool(logo.get("tint"))} if logo else None,
    }
    if backs.models()[template].get("logo") == "required" and not clean_back["logo"]:
        raise DesignError("Ce modèle de dos demande un logo.")
    _rgb(clean_back["color"], (0, 0, 0))
    _rgb(clean_back["ink"], (0, 0, 0))
    valid = {c.code for c in DECKS[deck_code].cards if c.code.split("-")[-1] in COURTS}
    courts = {}
    for code, court in (design.get("courts") or {}).items():
        if code not in valid:
            raise DesignError(f"Figure inconnue : {code}")
        if not isinstance(court, dict):
            raise DesignError("Figure invalide.")
        courts[code] = {"photo": _photo_spec(court.get("photo"))}
    style = design.get("style") or "couleur"
    if style not in classic.STYLES:
        raise DesignError(f"Style inconnu : {style}")
    return {"back": clean_back, "style": style, "courts": courts}


def photo_paths(design: dict) -> list[str]:
    paths = [design["back"]["photo"]["path"]] if design["back"].get("photo") else []
    paths += [design["back"]["logo"]["path"]] if design["back"].get("logo") else []
    paths += [c["photo"]["path"] for c in design["courts"].values() if c.get("photo")]
    return paths


def _card_images(design: dict, deck_code: str, load: PhotoLoader):
    yield render_back(design["back"], load), _rgb(design["back"]["color"], art.FELT), True
    for card in DECKS[deck_code].cards:
        court = design["courts"].get(card.code, {})
        photo = load(court["photo"]["path"]) if court.get("photo") else None
        crop = court["photo"] if photo is not None else None
        yield classic.court(classic.art_code(card.code), FRONT_PX, photo, crop, design["style"]), (255, 255, 255), False


def render_back(back: dict, load: PhotoLoader, px_per_mm: float = 14) -> Image.Image:
    """Dos pleine page, fond perdu compris, depuis son modèle SVG (le même que l'aperçu du studio)."""
    photo = logo = None
    if back.get("photo"):
        photo = backs.data_uri(art.crop_photo(load(back["photo"]["path"]), back["photo"], BACK_RATIO), "JPEG", 1400)
    if back.get("logo"):
        logo = backs.data_uri(load(back["logo"]["path"]), "PNG", 1400)
    values = backs.fields(back["template"], back["color"], back["ink"], back["title"], back["subtitle"],
                          logo, bool(back.get("logo") and back["logo"]["tint"]), photo)
    return backs.render(backs.fill(back["template"], values), round(backs.SIZE_MM[0] * px_per_mm)).convert("RGBA")


def render_playing_cards(design: dict, deck_code: str, out_pdf: str | Path, load: PhotoLoader,
                         trim_mm=(63.5, 88.9), bleed_mm: float = 3.0) -> Path:
    tw, th = mm_to_pt(trim_mm[0]), mm_to_pt(trim_mm[1])
    b = mm_to_pt(bleed_mm)
    c = canvas.Canvas(str(out_pdf), pagesize=(tw + 2 * b, th + 2 * b))
    c.setTitle("Jeu Carte Blanche — création en ligne")
    for img, bg, full_bleed in _card_images(design, deck_code, load):
        flat = Image.new("RGB", img.size, bg)
        flat.paste(img, mask=img.getchannel("A"))
        buf = io.BytesIO()
        flat.save(buf, "JPEG", quality=92, subsampling=0)
        buf.seek(0)
        c.setFillColorRGB(*(v / 255 for v in bg))
        c.rect(0, 0, tw + 2 * b, th + 2 * b, stroke=0, fill=1)
        if full_bleed:  # le dos couvre déjà le fond perdu
            c.drawImage(ImageReader(buf), 0, 0, tw + 2 * b, th + 2 * b)
        else:
            c.drawImage(ImageReader(buf), b, b, tw, th)
        c.showPage()
    c.save()
    return Path(out_pdf)


def preview_pages(design: dict, deck_code: str) -> list[int]:
    """Pages à montrer au client (1-based) : le dos, puis la première figure personnalisée."""
    codes = [c.code for c in DECKS[deck_code].cards]
    for code, court in design["courts"].items():
        if court.get("photo"):
            return [1, codes.index(code) + 2]
    return [1, 2]
