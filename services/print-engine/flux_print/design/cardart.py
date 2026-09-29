"""Dessin des cartes Carte Blanche (dos, as, cartes à points, figures à deux têtes, joker).

Base des gabarits « création en ligne » : les figures peuvent recevoir la photo
et le prénom d'un proche, le dos une couleur, un texte et une photo.
Polices livrées avec le moteur (licences OFL, DejaVu libre).
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

PX_PER_MM = 10
SS = 3  # suréchantillonnage pour l'anticrénelage
CW, CH = round(63.5 * PX_PER_MM), round(88.9 * PX_PER_MM)
RADIUS = round(3.5 * PX_PER_MM)

INK = (22, 22, 26)
RED = (196, 23, 44)
PAPER = (252, 252, 250)
FELT = (19, 69, 54)
CREAM = (240, 232, 214)
GOLD = (190, 150, 70)
SKIN = [(241, 207, 180), (222, 176, 140), (178, 126, 92), (120, 82, 58)]
HAIR = [(52, 36, 28), (120, 78, 40), (200, 160, 90), (30, 30, 34), (150, 60, 40)]

_FONT_DIR = Path(__file__).parent / "fonts"
FONTS: dict[str, str] = {
    "display": str(_FONT_DIR / "bricolage-grotesque-latin-800-normal.woff"),
    "display600": str(_FONT_DIR / "bricolage-grotesque-latin-600-normal.woff"),
    "body": str(_FONT_DIR / "hanken-grotesk-latin-500-normal.woff"),
    "serif": str(_FONT_DIR / "fraunces-latin-600-normal.woff"),
    "symbols": str(_FONT_DIR / "DejaVuSans.ttf"),
}


def load_fonts(root: str | None = None) -> None:
    """Compatibilité : les polices sont livrées avec le moteur."""


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONTS[kind], size)


SUITS = {"S": ("♠", INK), "H": ("♥", RED), "D": ("♦", RED), "C": ("♣", INK)}


# --- Dessin des cartes --------------------------------------------------------------

def crop_photo(photo: Image.Image, crop: dict | None, ratio: float = 1.0) -> Image.Image:
    """Recadrage : zone de proportions `ratio` (largeur/hauteur), centrée en (x, y) normalisés,
    agrandie de `zoom` (1 = la plus grande zone possible)."""
    photo = ImageOps.exif_transpose(photo).convert("RGB")
    crop = crop or {}
    zoom = max(1.0, float(crop.get("zoom", 1)))
    w, h = photo.size
    cw = min(w, h * ratio) / zoom
    ch = cw / ratio
    cx = min(max(float(crop.get("x", 0.5)) * w, cw / 2), w - cw / 2)
    cy = min(max(float(crop.get("y", 0.5)) * h, ch / 2), h - ch / 2)
    return photo.crop((round(cx - cw / 2), round(cy - ch / 2), round(cx + cw / 2), round(cy + ch / 2)))


def blank_card(fill=PAPER) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (CW * SS, CH * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, CW * SS - 1, CH * SS - 1), RADIUS * SS, fill=fill)
    return img, d


# Résolution de sortie : 12 px/mm ≈ 305 dpi (dessin interne à 10 px/mm × SS).
OUT_PX_PER_MM = 12


def finish(img: Image.Image) -> Image.Image:
    return img.resize((round(63.5 * OUT_PX_PER_MM), round(88.9 * OUT_PX_PER_MM)), Image.LANCZOS)


def draw_centered(d: ImageDraw.ImageDraw, xy, text, fnt, fill, anchor="mm"):
    d.text(xy, text, font=fnt, fill=fill, anchor=anchor)


def suit_glyph(size: int) -> ImageFont.FreeTypeFont:
    return font("symbols", size)


def paste_rotated_half(img: Image.Image, top: Image.Image) -> None:
    """Colle `top` en haut puis sa rotation à 180° en bas (symétrie centrale)."""
    img.alpha_composite(top, (0, 0))
    img.alpha_composite(top.rotate(180), (0, 0))


def corner_indices(img: Image.Image, rank: str, suit: str) -> None:
    glyph, color = SUITS[suit]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x = 44 * SS
    draw_centered(d, (x, 60 * SS), rank, font("display", (58 if len(rank) == 1 else 50) * SS), color)
    draw_centered(d, (x, 118 * SS), glyph, suit_glyph(44 * SS), color)
    paste_rotated_half(img, layer)


PIPS = {
    2: [(.5, 0), (.5, 1)],
    3: [(.5, 0), (.5, .5), (.5, 1)],
    4: [(0, 0), (1, 0), (0, 1), (1, 1)],
    5: [(0, 0), (1, 0), (.5, .5), (0, 1), (1, 1)],
    6: [(0, 0), (1, 0), (0, .5), (1, .5), (0, 1), (1, 1)],
    7: [(0, 0), (1, 0), (.5, .25), (0, .5), (1, .5), (0, 1), (1, 1)],
    8: [(0, 0), (1, 0), (.5, .25), (0, .5), (1, .5), (.5, .75), (0, 1), (1, 1)],
    9: [(0, 0), (1, 0), (0, 1 / 3), (1, 1 / 3), (.5, .5), (0, 2 / 3), (1, 2 / 3), (0, 1), (1, 1)],
    10: [(0, 0), (1, 0), (.5, 1 / 6), (0, 1 / 3), (1, 1 / 3), (0, 2 / 3), (1, 2 / 3), (.5, 5 / 6), (0, 1), (1, 1)],
}


def number_card(n: int, suit: str) -> Image.Image:
    img, d = blank_card()
    corner_indices(img, str(n), suit)
    glyph, color = SUITS[suit]
    g = suit_glyph(92 * SS)
    x0, x1 = 190 * SS, (CW - 190) * SS
    y0, y1 = 190 * SS, (CH - 190) * SS
    for fx, fy in PIPS[n]:
        x, y = x0 + fx * (x1 - x0), y0 + fy * (y1 - y0)
        pip = Image.new("RGBA", (140 * SS, 140 * SS), (0, 0, 0, 0))
        ImageDraw.Draw(pip).text((70 * SS, 70 * SS), glyph, font=g, fill=color, anchor="mm")
        if fy > .5:
            pip = pip.rotate(180)
        img.alpha_composite(pip, (int(x - 70 * SS), int(y - 70 * SS)))
    return finish(img)


def ace_card(suit: str, signature: str = "CARTE BLANCHE") -> Image.Image:
    img, d = blank_card()
    corner_indices(img, "A", suit)
    glyph, color = SUITS[suit]
    draw_centered(d, (CW * SS / 2, CH * SS / 2 - 20 * SS), glyph, suit_glyph(330 * SS), color)
    d.ellipse(((CW / 2 - 16) * SS, (CH / 2 - 60) * SS, (CW / 2 + 16) * SS, (CH / 2 - 28) * SS), fill=PAPER)
    draw_centered(d, (CW * SS / 2, (CH - 170) * SS), signature, font("display600", 22 * SS), color)
    return finish(img)


def portrait(d: ImageDraw.ImageDraw, cx: float, cy: float, s: float, skin, hair, crown: str, color, beard=False,
             long_hair=False, photo: Image.Image | None = None, canvas: Image.Image | None = None):
    """Portrait illustré à plat (tête + buste) centré sur (cx, cy), échelle s.
    Avec `photo` (déjà recadrée, carrée), le visage illustré est remplacé par la photo en médaillon."""
    # buste / costume
    d.pieslice((cx - 150 * s, cy + 40 * s, cx + 150 * s, cy + 340 * s), 180, 360, fill=color)
    d.polygon([(cx - 40 * s, cy + 90 * s), (cx, cy + 150 * s), (cx + 40 * s, cy + 90 * s)], fill=PAPER)
    for i in range(-2, 3):
        d.ellipse((cx + i * 26 * s - 6 * s, cy + 150 * s, cx + i * 26 * s + 6 * s, cy + 162 * s), fill=GOLD)
    if photo is not None and canvas is not None:
        r = int(84 * s)
        face = photo.resize((2 * r, 2 * r), Image.LANCZOS).convert("RGBA")
        mask = Image.new("L", face.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 2 * r - 1, 2 * r - 1), fill=255)
        face.putalpha(mask)
        d.ellipse((cx - r - 6 * s, cy - r - 6 * s, cx + r + 6 * s, cy + r + 6 * s), fill=GOLD)
        canvas.alpha_composite(face, (int(cx - r), int(cy - r)))
        _crown(d, cx, cy - 16 * s, s, crown, color)
        return
    if long_hair:
        d.rounded_rectangle((cx - 78 * s, cy - 70 * s, cx + 78 * s, cy + 90 * s), 60 * s, fill=hair)
    # cou + tête
    d.rectangle((cx - 22 * s, cy + 40 * s, cx + 22 * s, cy + 96 * s), fill=skin)
    d.ellipse((cx - 62 * s, cy - 70 * s, cx + 62 * s, cy + 70 * s), fill=skin)
    # cheveux
    d.chord((cx - 66 * s, cy - 78 * s, cx + 66 * s, cy + 30 * s), 180, 360, fill=hair)
    if beard:
        d.chord((cx - 60 * s, cy - 10 * s, cx + 60 * s, cy + 74 * s), 0, 180, fill=hair)
        d.rectangle((cx - 18 * s, cy + 22 * s, cx + 18 * s, cy + 30 * s), fill=skin)
    # yeux, sourire
    for dx in (-24, 24):
        d.ellipse((cx + (dx - 6) * s, cy - 6 * s, cx + (dx + 6) * s, cy + 6 * s), fill=INK)
    d.arc((cx - 20 * s, cy + 12 * s, cx + 20 * s, cy + 40 * s), 20, 160, fill=INK, width=max(2, int(5 * s)))
    _crown(d, cx, cy, s, crown, color)


def _crown(d: ImageDraw.ImageDraw, cx: float, cy: float, s: float, crown: str, color) -> None:
    """Couronne (Roi), diadème (Dame) ou toque à plume (Valet)."""
    if crown == "king":
        pts = [(cx - 58 * s, cy - 70 * s), (cx - 58 * s, cy - 130 * s), (cx - 30 * s, cy - 96 * s), (cx, cy - 142 * s),
               (cx + 30 * s, cy - 96 * s), (cx + 58 * s, cy - 130 * s), (cx + 58 * s, cy - 70 * s)]
        d.polygon(pts, fill=GOLD)
        d.ellipse((cx - 8 * s, cy - 118 * s, cx + 8 * s, cy - 102 * s), fill=RED)
    elif crown == "queen":
        d.chord((cx - 56 * s, cy - 120 * s, cx + 56 * s, cy - 40 * s), 180, 360, fill=GOLD)
        for dx in (-34, 0, 34):
            d.ellipse((cx + (dx - 8) * s, cy - 132 * s, cx + (dx + 8) * s, cy - 116 * s), fill=GOLD)
    else:  # valet
        d.rounded_rectangle((cx - 70 * s, cy - 104 * s, cx + 70 * s, cy - 62 * s), 18 * s, fill=color)
        d.line((cx + 40 * s, cy - 100 * s, cx + 96 * s, cy - 170 * s), fill=GOLD, width=int(12 * s))


def court_card(rank: str, suit: str, role: str, name: str, skin, hair, beard=False, long_hair=False,
               photo: Image.Image | None = None) -> Image.Image:
    img, d = blank_card()
    corner_indices(img, rank, suit)
    glyph, color = SUITS[suit]
    frame = (96 * SS, 96 * SS, (CW - 96) * SS, (CH - 96) * SS)
    d.rounded_rectangle(frame, 18 * SS, outline=color, width=4 * SS)
    half = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(half)
    cx, cy = CW * SS / 2, (CH / 2 - 190) * SS
    portrait(hd, cx, cy, 0.9 * SS, skin, hair, role, color, beard=beard, long_hair=long_hair, photo=photo, canvas=half)
    hd.text((frame[0] + 22 * SS, frame[1] + 18 * SS), glyph, font=suit_glyph(52 * SS), fill=color)
    # rogne la moitié haute au cadre, puis symétrie centrale
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rectangle((frame[0] + 4 * SS, frame[1] + 4 * SS, frame[2] - 4 * SS, CH * SS / 2), fill=255)
    half.putalpha(ImageChops.multiply(half.getchannel("A"), mask))
    paste_rotated_half(img, half)
    d = ImageDraw.Draw(img)
    d.line((frame[0], CH * SS / 2, frame[2], CH * SS / 2), fill=color, width=3 * SS)
    tag = Image.new("RGBA", img.size, (0, 0, 0, 0))
    td = ImageDraw.Draw(tag)
    w = 230 * SS
    if name:
        td.rounded_rectangle((cx - w / 2, (CH / 2 - 44) * SS, cx + w / 2, (CH / 2 - 6) * SS), 19 * SS, fill=PAPER,
                         outline=color, width=3 * SS)
    if name:
        td.text((cx, (CH / 2 - 25) * SS), name.upper()[:16], font=font("display600", 22 * SS), fill=color, anchor="mm")
    img.alpha_composite(tag)
    img.alpha_composite(tag.rotate(180))
    return finish(img)


def joker_card() -> Image.Image:
    img, d = blank_card()
    d.text((44 * SS, 70 * SS), "J\nO\nK\nE\nR", font=font("display", 34 * SS), fill=RED, anchor="ma", align="center",
           spacing=-4 * SS)
    cx, cy = CW * SS / 2, CH * SS / 2
    star = [(cx + math.cos(math.radians(-90 + i * 36)) * (150 if i % 2 == 0 else 62) * SS,
             cy - 30 * SS + math.sin(math.radians(-90 + i * 36)) * (150 if i % 2 == 0 else 62) * SS) for i in range(10)]
    d.polygon(star, fill=RED)
    draw_centered(d, (cx, cy + 200 * SS), "Le joker de la famille", font("serif", 30 * SS), INK)
    return finish(img)


def back_card(fill=FELT, ink=CREAM, title="CB", subtitle: str | None = None, motif="diamond",
              photo: Image.Image | None = None) -> Image.Image:
    """Dos : motif symétrique et médaillon, ou photo plein cadre avec médaillon.
    Rester symétrique compte : un dos décalé ou orienté rendrait les cartes reconnaissables."""
    img, d = blank_card(fill)
    inset = 28 * SS
    d.rounded_rectangle((inset, inset, CW * SS - inset, CH * SS - inset), 14 * SS, outline=ink, width=3 * SS)
    inner = (inset + 16 * SS, inset + 16 * SS, CW * SS - inset - 16 * SS, CH * SS - inset - 16 * SS)
    pattern = Image.new("RGBA", img.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(pattern)
    step = 46 * SS
    alpha = (*ink, 70)
    for yi, y in enumerate(range(inner[1], inner[3] + step, step)):
        for x in range(inner[0] + (step // 2 if yi % 2 else 0), inner[2] + step, step):
            if motif == "diamond":
                r = 9 * SS
                pd.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=alpha)
            else:
                pd.ellipse((x - 5 * SS, y - 5 * SS, x + 5 * SS, y + 5 * SS), fill=alpha)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(inner, 8 * SS, fill=255)
    pattern.putalpha(ImageChops.multiply(pattern.getchannel("A"), mask))
    if photo is not None:
        iw, ih = inner[2] - inner[0], inner[3] - inner[1]
        fitted = photo.resize((iw, ih), Image.LANCZOS).convert("RGBA")
        fitted.putalpha(mask.crop(inner))
        img.alpha_composite(fitted, (inner[0], inner[1]))
    else:
        img.alpha_composite(pattern)
    d = ImageDraw.Draw(img)
    cx, cy = CW * SS / 2, CH * SS / 2
    if photo is not None and not title and not subtitle:
        return finish(img)
    r = 150 * SS
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=ink, width=4 * SS)
    d.ellipse((cx - r + 14 * SS, cy - r + 14 * SS, cx + r - 14 * SS, cy + r - 14 * SS), outline=ink, width=2 * SS)
    if subtitle:
        draw_centered(d, (cx, cy - 26 * SS), title, font("serif", 58 * SS), ink)
        draw_centered(d, (cx, cy + 48 * SS), subtitle, font("display600", 24 * SS), ink)
    else:
        draw_centered(d, (cx, cy), title, font("display", 120 * SS), ink)
    return finish(img)
