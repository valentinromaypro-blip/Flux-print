"""Visuels de la maquette Carte Blanche, dessinés à partir de vraies cartes.

Dessine un jeu (dos, as, cartes à points, figures personnalisées à deux têtes,
joker) au format poker 63,5 × 88,9 mm, puis compose des mises en scène
façon photo produit : éventail sur tapis, jeu et étui, détail du coin,
dos personnalisés par occasion.

Ces images servent de maquette en attendant les photos des jeux imprimés à
l'atelier, qui les remplaceront.

    python generate_visuals.py <dossier_polices_fontsource> <dossier_sortie>
"""

from __future__ import annotations

import glob
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

PX_PER_MM = 10
SS = 2  # suréchantillonnage pour l'anticrénelage
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

FONTS: dict[str, str] = {}


def load_fonts(root: str) -> None:
    def find(pattern: str) -> str:
        return glob.glob(str(Path(root) / "**" / pattern), recursive=True)[0]

    FONTS["display"] = find("bricolage-grotesque-latin-800-normal.woff")
    FONTS["display600"] = find("bricolage-grotesque-latin-600-normal.woff")
    FONTS["body"] = find("hanken-grotesk-latin-500-normal.woff")
    FONTS["serif"] = find("fraunces-latin-600-normal.woff")
    FONTS["symbols"] = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONTS[kind], size)


SUITS = {"S": ("♠", INK), "H": ("♥", RED), "D": ("♦", RED), "C": ("♣", INK)}


# --- Dessin des cartes --------------------------------------------------------------

def blank_card(fill=PAPER) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (CW * SS, CH * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, CW * SS - 1, CH * SS - 1), RADIUS * SS, fill=fill)
    return img, d


def finish(img: Image.Image) -> Image.Image:
    return img.resize((CW, CH), Image.LANCZOS)


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
             long_hair=False):
    """Portrait illustré à plat (tête + buste) centré sur (cx, cy), échelle s."""
    # buste / costume
    d.pieslice((cx - 150 * s, cy + 40 * s, cx + 150 * s, cy + 340 * s), 180, 360, fill=color)
    d.polygon([(cx - 40 * s, cy + 90 * s), (cx, cy + 150 * s), (cx + 40 * s, cy + 90 * s)], fill=PAPER)
    for i in range(-2, 3):
        d.ellipse((cx + i * 26 * s - 6 * s, cy + 150 * s, cx + i * 26 * s + 6 * s, cy + 162 * s), fill=GOLD)
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
    # couronne / toque / plume
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


def court_card(rank: str, suit: str, role: str, name: str, skin, hair, beard=False, long_hair=False) -> Image.Image:
    img, d = blank_card()
    corner_indices(img, rank, suit)
    glyph, color = SUITS[suit]
    frame = (96 * SS, 96 * SS, (CW - 96) * SS, (CH - 96) * SS)
    d.rounded_rectangle(frame, 18 * SS, outline=color, width=4 * SS)
    half = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(half)
    cx, cy = CW * SS / 2, (CH / 2 - 190) * SS
    portrait(hd, cx, cy, 0.9 * SS, skin, hair, role, color, beard=beard, long_hair=long_hair)
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
    td.rounded_rectangle((cx - w / 2, (CH / 2 - 44) * SS, cx + w / 2, (CH / 2 - 6) * SS), 19 * SS, fill=PAPER,
                         outline=color, width=3 * SS)
    td.text((cx, (CH / 2 - 25) * SS), name.upper(), font=font("display600", 22 * SS), fill=color, anchor="mm")
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


def back_card(fill=FELT, ink=CREAM, title="CB", subtitle: str | None = None, motif="diamond") -> Image.Image:
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
    img.alpha_composite(pattern)
    d = ImageDraw.Draw(img)
    cx, cy = CW * SS / 2, CH * SS / 2
    r = 150 * SS
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=ink, width=4 * SS)
    d.ellipse((cx - r + 14 * SS, cy - r + 14 * SS, cx + r - 14 * SS, cy + r - 14 * SS), outline=ink, width=2 * SS)
    if subtitle:
        draw_centered(d, (cx, cy - 26 * SS), title, font("serif", 58 * SS), ink)
        draw_centered(d, (cx, cy + 48 * SS), subtitle, font("display600", 24 * SS), ink)
    else:
        draw_centered(d, (cx, cy), title, font("display", 120 * SS), ink)
    return finish(img)


def tuck_box(title_color=FELT) -> Image.Image:
    """Face avant d'un étui (légèrement plus grand que les cartes)."""
    w, h = CW + 50, CH + 40
    img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w * SS, h * SS), fill=title_color)
    d.rectangle((0, 0, w * SS, 70 * SS), fill=tuple(max(0, c - 12) for c in title_color))
    d.arc(((w / 2 - 70) * SS, 30 * SS, (w / 2 + 70) * SS, 110 * SS), 0, 180, fill=CREAM, width=3 * SS)
    cx, cy = w * SS / 2, h * SS / 2 + 30 * SS
    draw_centered(d, (cx, cy - 90 * SS), "♠ ♥ ♦ ♣", suit_glyph(44 * SS), CREAM)
    draw_centered(d, (cx, cy), "Carte", font("display", 96 * SS), CREAM)
    draw_centered(d, (cx, cy + 96 * SS), "Blanche", font("display", 96 * SS), CREAM)
    draw_centered(d, (cx, cy + 200 * SS), "54 CARTES · IMPRIMÉ EN FRANCE", font("display600", 20 * SS), CREAM)
    return img.resize((w, h), Image.LANCZOS)


# --- Mise en scène ----------------------------------------------------------------------

def texture(size, base, grain=10, fibers=0, seed=1) -> Image.Image:
    rng = np.random.default_rng(seed)
    w, h = size
    arr = np.ones((h, w, 3), np.float32) * np.array(base, np.float32)
    noise = rng.normal(0, grain, (h // 2 + 1, w // 2 + 1, 1)).astype(np.float32)
    noise = np.kron(noise, np.ones((2, 2, 1), np.float32))[:h, :w]
    arr += noise
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    if fibers:
        d = ImageDraw.Draw(img)
        r = random.Random(seed)
        for _ in range(fibers):
            x, y = r.uniform(0, w), r.uniform(0, h)
            a = r.uniform(0, math.pi)
            l = r.uniform(6, 24)
            c = tuple(int(v + r.uniform(-18, 18)) for v in base)
            d.line((x, y, x + math.cos(a) * l, y + math.sin(a) * l), fill=c, width=1)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img


def light(img: Image.Image, strength=0.35, cx=0.3, cy=0.2) -> Image.Image:
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt(((xx / w - cx) * 1.2) ** 2 + (yy / h - cy) ** 2)
    factor = 1.08 - strength * np.clip(dist, 0, 1.4)
    arr = np.asarray(img.convert("RGB"), np.float32) * factor[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def add_paper_grain(card: Image.Image, seed=0) -> Image.Image:
    rng = np.random.default_rng(seed)
    arr = np.asarray(card, np.float32).copy()
    n = rng.normal(0, 3.2, arr.shape[:2])[..., None]
    arr[..., :3] = np.clip(arr[..., :3] + n, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def place(scene: Image.Image, obj: Image.Image, center, angle=0.0, scale=1.0, shadow=18, lift=10, shade=0.0):
    o = obj.resize((int(obj.width * scale), int(obj.height * scale)), Image.LANCZOS)
    o = add_paper_grain(o, seed=int(center[0] + center[1]))
    if shade:
        g = Image.new("L", o.size)
        gd = np.linspace(1.0, 1.0 - shade, o.height, dtype=np.float32)[:, None] * np.ones((1, o.width), np.float32)
        arr = np.asarray(o, np.float32).copy()
        arr[..., :3] *= gd[..., None]
        o = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    o = o.rotate(angle, resample=Image.BICUBIC, expand=True)
    # marge transparente : le flou de l'ombre ne doit pas être coupé au bord de l'image
    pad = shadow * 3 + lift + 4
    padded = Image.new("RGBA", (o.width + 2 * pad, o.height + 2 * pad), (0, 0, 0, 0))
    padded.alpha_composite(o, (pad, pad))
    o = padded
    x, y = int(center[0] - o.width / 2), int(center[1] - o.height / 2)
    sh = Image.new("RGBA", o.size, (0, 0, 0, 0))
    sh.putalpha(o.getchannel("A").point(lambda a: int(a * 0.55)))
    sh = sh.filter(ImageFilter.GaussianBlur(shadow))
    scene.alpha_composite(sh, (x + lift // 2, y + lift))
    contact = Image.new("RGBA", o.size, (0, 0, 0, 0))
    contact.putalpha(o.getchannel("A").point(lambda a: int(a * 0.35)))
    scene.alpha_composite(contact.filter(ImageFilter.GaussianBlur(2)), (x + 1, y + 2))
    scene.alpha_composite(o, (x, y))


def deck_stack(scene, card_top, center, angle, scale, count=26, dx=0.6, dy=-0.9):
    edge = Image.new("RGBA", card_top.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, card_top.width - 1, card_top.height - 1), RADIUS, fill=(236, 235, 231),
                                           outline=(205, 204, 198), width=2)
    for i in range(count):
        place(scene, edge, (center[0] + i * dx, center[1] + i * dy), angle, scale, shadow=16 if i == 0 else 0,
              lift=8 if i == 0 else 0)
    place(scene, card_top, (center[0] + count * dx, center[1] + count * dy), angle, scale, shadow=0, lift=0)


def oracle_card(title: str, motif: str, bg, ink) -> Image.Image:
    """Carte oracle au format tarot 70 × 120 mm."""
    w, h, r = 700 * SS, 1200 * SS, 35 * SS
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), r, fill=bg)
    d.rounded_rectangle((34 * SS, 34 * SS, w - 34 * SS, h - 34 * SS), 18 * SS, outline=ink, width=3 * SS)
    cx, cy = w / 2, h * 0.42
    if motif == "moon":
        d.ellipse((cx - 170 * SS, cy - 170 * SS, cx + 170 * SS, cy + 170 * SS), fill=ink)
        d.ellipse((cx - 100 * SS, cy - 200 * SS, cx + 220 * SS, cy + 140 * SS), fill=bg)
    elif motif == "sun":
        for i in range(24):
            a = math.radians(i * 15)
            d.line((cx + math.cos(a) * 150 * SS, cy + math.sin(a) * 150 * SS, cx + math.cos(a) * 230 * SS,
                    cy + math.sin(a) * 230 * SS), fill=ink, width=6 * SS)
        d.ellipse((cx - 120 * SS, cy - 120 * SS, cx + 120 * SS, cy + 120 * SS), fill=ink)
    elif motif == "star":
        pts = [(cx + math.cos(math.radians(-90 + i * 36)) * (220 if i % 2 == 0 else 80) * SS,
                cy + math.sin(math.radians(-90 + i * 36)) * (220 if i % 2 == 0 else 80) * SS) for i in range(10)]
        d.polygon(pts, fill=ink)
    elif motif == "eye":
        d.ellipse((cx - 230 * SS, cy - 110 * SS, cx + 230 * SS, cy + 110 * SS), outline=ink, width=8 * SS)
        d.ellipse((cx - 70 * SS, cy - 70 * SS, cx + 70 * SS, cy + 70 * SS), fill=ink)
    else:  # dos
        for k in range(7):
            rr = (60 + k * 40) * SS
            d.ellipse((cx - rr, h / 2 - rr, cx + rr, h / 2 + rr), outline=ink, width=2 * SS)
        d.text((cx, h / 2), "✦", font=suit_glyph(90 * SS), fill=ink, anchor="mm")
        return img.resize((700, 1200), Image.LANCZOS)
    for dx, dy in ((-230, -380), (230, -380), (-250, 150), (240, 180)):
        d.text((cx + dx * SS, cy + dy * SS), "✦", font=suit_glyph(34 * SS), fill=ink, anchor="mm")
    d.text((cx, h * 0.78), title, font=font("serif", 64 * SS), fill=ink, anchor="mm")
    d.line((cx - 60 * SS, h * 0.84, cx + 60 * SS, h * 0.84), fill=ink, width=2 * SS)
    return img.resize((700, 1200), Image.LANCZOS)


def to_jpeg(img: Image.Image, path: Path, quality=84):
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def main(font_root: str, out: str) -> None:
    load_fonts(font_root)
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)

    king = court_card("R", "H", "king", "Papa", SKIN[0], HAIR[3], beard=True)
    queen = court_card("D", "D", "queen", "Maman", SKIN[1], HAIR[1], long_hair=True)
    jack = court_card("V", "C", "jack", "Léo", SKIN[0], HAIR[2])
    queen2 = court_card("D", "S", "queen", "Mamie", SKIN[2], HAIR[4], long_hair=True)
    ace = ace_card("S")
    back = back_card()
    cards = {
        "back": back, "ace": ace, "king": king, "queen": queen, "jack": jack, "queen2": queen2,
        "ten": number_card(10, "H"), "seven": number_card(7, "S"), "five": number_card(5, "D"),
        "three": number_card(3, "C"), "joker": joker_card(),
    }
    for name, img in cards.items():
        img.save(out_dir / f"carte-{name}.png", optimize=True)

    # 1. Héros : éventail sur tapis vert
    W, H = 2400, 1500
    scene = light(texture((W, H), FELT, grain=9, fibers=9000, seed=3), 0.45, 0.62, 0.25).convert("RGBA")
    fan = [back, cards["seven"], cards["ten"], ace, queen, king, jack]
    for i, c in enumerate(fan):
        a = 34 - i * 11.3
        rad = math.radians(a)
        cx = 1500 + math.sin(-rad) * 520
        cy = 1180 - math.cos(rad) * 520 + 40
        place(scene, c, (cx, cy), a, 1.05, shadow=22, lift=14)
    place(scene, tuck_box(), (560, 820), 8, 0.95, shadow=30, lift=22)
    to_jpeg(scene, out_dir / "scene-hero.jpg")

    # 2. Jeu et étui sur table claire
    W, H = 1600, 1200
    table = light(texture((W, H), (226, 220, 208), grain=7, fibers=5000, seed=7), 0.3, 0.2, 0.1).convert("RGBA")
    deck_stack(table, back, (520, 640), -12, 0.95)
    place(table, tuck_box(), (1080, 560), 6, 0.9, shadow=26, lift=18)
    place(table, ace, (1200, 1010), -24, 0.8, shadow=16, lift=8)
    to_jpeg(table, out_dir / "scene-etui.jpg")

    # 3. Figures personnalisées, famille
    W, H = 1600, 1200
    s3 = light(texture((W, H), (238, 236, 231), grain=6, seed=11), 0.25, 0.3, 0.2).convert("RGBA")
    for (card, x, y, a) in ((queen2, 360, 640, 9), (queen, 640, 560, 3), (king, 950, 600, -4), (jack, 1240, 660, -10)):
        place(s3, card, (x, y), a, 0.92, shadow=20, lift=12)
    to_jpeg(s3, out_dir / "scene-famille.jpg")

    # 4. Détail : coin de carte en macro, faible profondeur de champ
    big = king.resize((CW * 3, CH * 3), Image.LANCZOS)
    crop = big.crop((0, 0, 1300, 1000))
    base = texture((1600, 1200), (30, 30, 34), grain=5, seed=5).convert("RGBA")
    place(base, crop, (900, 640), -8, 1.0, shadow=30, lift=18)
    blur = base.filter(ImageFilter.GaussianBlur(9))
    mask = Image.linear_gradient("L").resize(base.size).point(lambda v: min(255, max(0, int((v - 110) * 2.4))))
    detail = Image.composite(blur, base, mask)
    to_jpeg(light(detail, 0.25, 0.3, 0.3), out_dir / "scene-detail.jpg")

    # 5. Oracle au format tarot
    midnight, sand = (28, 36, 64), (232, 214, 176)
    W, H = 1600, 1200
    s5 = light(texture((W, H), (58, 52, 48), grain=8, fibers=6000, seed=21), 0.4, 0.35, 0.2).convert("RGBA")
    for card, x, y, a in ((oracle_card("", "back", midnight, sand), 330, 640, 12),
                          (oracle_card("La Lune", "moon", midnight, sand), 640, 600, 4),
                          (oracle_card("Le Soleil", "sun", sand, midnight), 950, 610, -5),
                          (oracle_card("L'Étoile", "star", midnight, sand), 1260, 650, -13)):
        place(s5, card, (x, y), a, 0.72, shadow=24, lift=14)
    to_jpeg(s5, out_dir / "scene-oracle.jpg")

    # 6. Dos par occasion
    occasions = {
        "mariage": back_card((246, 241, 230), (160, 124, 60), "J & M", "12 · 06 · 2027", motif="dot"),
        "anniversaire": back_card((196, 23, 44), (252, 236, 220), "40", "CLAIRE · 2027"),
        "entreprise": back_card((22, 22, 26), (230, 230, 226), "N", "STUDIO NORD"),
        "evjf": back_card((238, 196, 200), (120, 30, 60), "EVJF", "MARSEILLE 2027", motif="dot"),
    }
    for name, b in occasions.items():
        W, H = 1000, 1100
        s = light(texture((W, H), (232, 228, 220), grain=6, seed=hash(name) % 100), 0.28, 0.25, 0.15).convert("RGBA")
        place(s, b, (430, 560), -8, 1.0, shadow=22, lift=14)
        place(s, b, (620, 520), 7, 1.0, shadow=22, lift=14)
        to_jpeg(s, out_dir / f"occasion-{name}.jpg")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
