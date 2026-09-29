"""Jeu classique personnalisable : les figures traditionnelles (dessins d'Adrian Kennard,
domaine public CC0) dont la tête est remplacée par le visage du client.

Le visage est recadré (zoom, x, y choisis par le client), traité en gravure aux
couleurs du dessin (ou laissé en couleur), détouré en ovale fondu et glissé sous
la couronne ; la tête du bas reçoit la même, retournée à 180°.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import resvg_py
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

from .cardart import crop_photo, draw_centered, font

DIR = Path(__file__).parent / "classic"
UNITS = (240, 336)
LINE = (68, 68, 255)  # bleu des traits du dessin
STYLES = {"gravure", "couleur"}
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


def _face_layer(photo: Image.Image, slot: list[float], k: float, style: str) -> tuple[Image.Image, Image.Image, tuple[int, int]]:
    """Visage détouré à coller : image, masque et coin haut-gauche (en pixels de la carte)."""
    cx, cy, rx, ry, top = slot
    w, h = round(2 * rx * k), round(2 * ry * k)
    face = stylise(photo.resize((w, h), Image.LANCZOS), style)
    mask = Image.new("L", (w, h), 0)
    feather = max(2, round(1.6 * k))
    ImageDraw.Draw(mask).ellipse((feather, feather, w - feather, h - feather), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.6))
    cut = round((top - (cy - ry)) * k)  # le haut de la tête passe sous la couronne
    if cut > 0:
        ImageDraw.Draw(mask).rectangle((0, 0, w, cut), fill=0)
    outline = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(outline).ellipse((feather, feather, w - feather, h - feather), outline=LINE + (255,),
                                    width=max(2, round(1.1 * k)))
    if cut > 0:
        ImageDraw.Draw(outline).rectangle((0, 0, w, cut), fill=(0, 0, 0, 0))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer.paste(face, mask=mask)
    layer.alpha_composite(outline)
    return layer, ImageChops.lighter(mask, outline.getchannel("A")), (round((cx - rx) * k), round((cy - ry) * k))


def court(code: str, width: int, photo: Image.Image | None = None, crop: dict | None = None,
          style: str = "gravure", name: str = "") -> Image.Image:
    """Figure à `width` px de large ; `photo` remplace les deux têtes."""
    img = card_image(code, width)
    k = width / UNITS[0]
    if photo is not None and code in FACES:
        slot = FACES[code]
        layer, _, (x, y) = _face_layer(crop_photo(photo, crop, slot[2] / slot[3]), slot, k, style)
        img.alpha_composite(layer, (x, y))
        flipped = layer.rotate(180)
        img.alpha_composite(flipped, (img.width - x - layer.width, img.height - y - layer.height))
    if name:
        _ribbon(img, name, k)
    return img


def _ribbon(img: Image.Image, name: str, k: float) -> None:
    d = ImageDraw.Draw(img)
    fnt = font("serif", round(11 * k))
    tw = d.textlength(name.upper(), font=fnt)
    w, h = tw + 22 * k, 17 * k
    cx, cy = img.width / 2, img.height / 2
    box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    d.rounded_rectangle(box, radius=3 * k, fill=(255, 250, 235), outline=LINE, width=max(2, round(1.1 * k)))
    draw_centered(d, (cx, cy + 0.5 * k), name.upper(), fnt, (190, 20, 30))
