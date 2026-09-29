"""Création en ligne : un « design » client devient le PDF d'impression.

Design d'un jeu de cartes (JSON stocké sur la ligne de commande) :

    {
      "back":   {"color": "#134536", "ink": "#F0E8D6", "title": "J & M", "subtitle": "12 · 06 · 2027",
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
from . import classic

COURTS = {"J": ("V", "jack"), "Q": ("D", "queen"), "K": ("R", "king")}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PhotoLoader = Callable[[str], Image.Image]
FRONT_PX = round(art.OUT_PX_PER_MM * 63.5)
BACK_RATIO = (63.5 - 13.2) / (88.9 - 13.2)  # zone intérieure du dos, 6,6 mm du bord (largeur / hauteur)


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
    clean_back = {
        "color": back.get("color") or "#134536",
        "ink": back.get("ink") or "#F0E8D6",
        "title": str(back.get("title") or "")[:12],
        "subtitle": str(back.get("subtitle") or "")[:24],
        "photo": _photo_spec(back.get("photo")),
    }
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
    paths += [c["photo"]["path"] for c in design["courts"].values() if c.get("photo")]
    return paths


def _card_images(design: dict, deck_code: str, load: PhotoLoader):
    back = design["back"]
    fill, ink = _rgb(back["color"], art.FELT), _rgb(back["ink"], art.CREAM)
    photo = art.crop_photo(load(back["photo"]["path"]), back["photo"], BACK_RATIO) if back.get("photo") else None
    yield art.back_card(fill, ink, back["title"] or ("" if photo else "CB"), back["subtitle"] or None, photo=photo), fill
    for card in DECKS[deck_code].cards:
        court = design["courts"].get(card.code, {})
        photo = load(court["photo"]["path"]) if court.get("photo") else None
        crop = court["photo"] if photo is not None else None
        yield classic.court(classic.art_code(card.code), FRONT_PX, photo, crop, design["style"]), (255, 255, 255)


def render_playing_cards(design: dict, deck_code: str, out_pdf: str | Path, load: PhotoLoader,
                         trim_mm=(63.5, 88.9), bleed_mm: float = 3.0) -> Path:
    tw, th = mm_to_pt(trim_mm[0]), mm_to_pt(trim_mm[1])
    b = mm_to_pt(bleed_mm)
    c = canvas.Canvas(str(out_pdf), pagesize=(tw + 2 * b, th + 2 * b))
    c.setTitle("Jeu Carte Blanche — création en ligne")
    for img, bg in _card_images(design, deck_code, load):
        flat = Image.new("RGB", img.size, bg)
        flat.paste(img, mask=img.getchannel("A"))
        buf = io.BytesIO()
        flat.save(buf, "JPEG", quality=92, subsampling=0)
        buf.seek(0)
        c.setFillColorRGB(*(v / 255 for v in bg))
        c.rect(0, 0, tw + 2 * b, th + 2 * b, stroke=0, fill=1)
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
