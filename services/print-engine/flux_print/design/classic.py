"""Jeu classique personnalisable : les figures traditionnelles (dessins d'Adrian Kennard,
domaine public CC0) dont la tête est remplacée par le visage du client.

Le visage est recadré (zoom, x, y choisis par le client), laissé en couleur ou
traité en gravure aux couleurs du dessin, puis glissé sous la couronne ; la tête du
bas reçoit la même, retournée à 180°. La tête arrive détourée par l'éditeur du site
(PNG transparent) ; une photo ordinaire est découpée en ovale fondu.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import resvg_py
from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .cardart import crop_photo

DIR = Path(__file__).parent / "classic"
UNITS = (240, 336)
LINE = (68, 68, 255)  # bleu des traits du dessin
LINE_DARK = (34, 34, 122)  # contour des visages
STYLES = {"couleur", "gravure"}
HEAD_ROOM = 1.6  # la tête détourée peut déborder de la tête d'origine (zone 1,6 × plus grande)
FACES: dict[str, list[float]] = {k: v for k, v in json.loads((DIR / "faces.json").read_text()).items()
                                 if not k.startswith("_")}


def art_code(card_code: str) -> str:
    """"H-K" → "HK", "JK-1" → "J1"."""
    a, b = card_code.split("-")
    return f"J{b}" if a == "JK" else a + b


@lru_cache(maxsize=64)
def _render(code: str, width: int) -> bytes:
    return bytes(resvg_py.svg_to_bytes(svg_path=str(DIR / f"{code}.svg"), width=width, skip_system_fonts=True))


def card_image(code: str, width: int) -> Image.Image:
    from io import BytesIO

    return Image.open(BytesIO(_render(code, width))).convert("RGBA")


def stylise(face: Image.Image, style: str) -> Image.Image:
    if style == "couleur":
        return ImageOps.autocontrast(face.convert("RGB"), cutoff=1)
    grey = ImageOps.autocontrast(ImageOps.grayscale(face), cutoff=2)
    grey = grey.filter(ImageFilter.UnsharpMask(radius=2, percent=160, threshold=2))
    # Gravure : les ombres prennent le bleu des traits, les lumières restent blanches.
    return ImageOps.colorize(grey, black=(18, 18, 96), mid=(88, 88, 240), white=(255, 255, 255),
                             blackpoint=10, whitepoint=235, midpoint=110)


def place_head(head: Image.Image, crop: dict | None, iw: int, ih: int, w: int, h: int) -> Image.Image:
    """Tête détourée dans une zone w × h centrée sur la tête d'origine (iw × ih) : ajustée à
    iw × ih sans rognage (zoom 1), puis agrandie ou réduite (`zoom`) et décalée (`x`, `y` :
    0,5 = centré, ±0,5 = une demi-largeur ou demi-hauteur de la tête d'origine)."""
    crop = crop or {}
    s = min(iw / head.width, ih / head.height) * float(crop.get("zoom", 1))
    nw, nh = max(1, round(head.width * s)), max(1, round(head.height * s))
    x = round((w - nw) / 2 + (float(crop.get("x", 0.5)) - 0.5) * iw)
    y = round((h - nh) / 2 + (float(crop.get("y", 0.5)) - 0.5) * ih)
    box = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    box.paste(head.resize((nw, nh), Image.LANCZOS), (x, y))
    return box


def _face_layer(photo: Image.Image, crop: dict | None, slot: list[float], k: float,
                style: str) -> tuple[Image.Image, tuple[int, int]]:
    """Visage à coller et son coin haut-gauche (en pixels de la carte).

    Tête détourée (PNG transparent, fournie par l'éditeur) : posée librement dans une zone
    plus large que la tête d'origine, cernée d'un trait comme le dessin. Photo ordinaire :
    recadrée et découpée en ovale fondu. Dans les deux cas, le haut passe sous la couronne.
    """
    cx, cy, rx, ry, top = slot
    stroke = max(2, round(1.1 * k))
    if "A" in photo.getbands():
        m = HEAD_ROOM
        w, h = round(2 * rx * k * m), round(2 * ry * k * m)
        face = place_head(photo.convert("RGBA"), crop, round(2 * rx * k), round(2 * ry * k), w, h)
        mask = face.getchannel("A")
        ring = mask.point(lambda v: 255 if v > 110 else 0).filter(ImageFilter.MaxFilter(2 * stroke + 1))
    else:
        w, h = round(2 * rx * k), round(2 * ry * k)
        face = crop_photo(photo, crop, rx / ry).resize((w, h), Image.LANCZOS)
        feather = max(2, round(1.6 * k))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).ellipse((feather, feather, w - feather, h - feather), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.6))
        ring = Image.new("L", (w, h), 0)
        ImageDraw.Draw(ring).ellipse((feather, feather, w - feather, h - feather), outline=255, width=stroke)
    x0, y0 = round(cx * k - w / 2), round(cy * k - h / 2)
    layer = Image.new("RGBA", (w, h), LINE_DARK + (0,))
    layer.putalpha(ring)
    layer.paste(stylise(face.convert("RGB"), style), mask=mask)
    cut = round(top * k) - y0
    if cut > 0:
        ImageDraw.Draw(layer).rectangle((0, 0, w, cut), fill=(0, 0, 0, 0))
    return layer, (x0, y0)


def court(code: str, width: int, photo: Image.Image | None = None, crop: dict | None = None,
          style: str = "couleur") -> Image.Image:
    """Figure à `width` px de large ; `photo` remplace les deux têtes."""
    img = card_image(code, width)
    k = width / UNITS[0]
    if photo is not None and code in FACES:
        layer, (x, y) = _face_layer(ImageOps.exif_transpose(photo), crop, FACES[code], k, style)
        img.alpha_composite(_clip(layer, x, y, img.size), (max(0, x), max(0, y)))
        flipped = layer.rotate(180)
        fx, fy = img.width - x - layer.width, img.height - y - layer.height
        img.alpha_composite(_clip(flipped, fx, fy, img.size), (max(0, fx), max(0, fy)))
    return img


def _clip(layer: Image.Image, x: int, y: int, size: tuple[int, int]) -> Image.Image:
    """Partie du calque qui tombe dans la carte (alpha_composite refuse les débords)."""
    return layer.crop((max(0, -x), max(0, -y), min(layer.width, size[0] - x), min(layer.height, size[1] - y)))
