"""Dos de cartes : modèles SVG partagés avec le studio du site.

Chaque modèle (`backs/<id>.svg`) contient des champs {{…}} remplis de la même façon
ici et dans le navigateur (apps/site/src/lib/backs.ts) : l'aperçu du client et le
fichier d'impression partent du même dessin. Les SVG se modifient ou s'ajoutent
dans un logiciel de dessin, en gardant les champs.
"""

from __future__ import annotations

import base64
import io
import json
import re
from functools import lru_cache
from pathlib import Path

import resvg_py
from PIL import Image, ImageOps

DIR = Path(__file__).parent / "backs"
FONTS = sorted(str(p) for p in (DIR / "fonts").glob("*.ttf"))
SIZE_MM = (69.5, 94.9)  # carte 63,5 × 88,9 + 3 mm de fond perdu
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="
TITLE_MAX, SUBTITLE_MAX = 20, 32


@lru_cache(maxsize=1)
def models() -> dict[str, dict]:
    return {m["id"]: m for m in json.loads((DIR / "models.json").read_text())["models"]}


@lru_cache(maxsize=16)
def template(model_id: str) -> str:
    return (DIR / f"{model_id}.svg").read_text()


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _num(v: float) -> str:
    return f"{v:.2f}"


def fields(model_id: str, bg: str, ink: str, title: str = "", subtitle: str = "", logo: str | None = None,
           tint: bool = False, photo: str | None = None) -> dict[str, str]:
    """Valeurs des champs d'un modèle. `logo` / `photo` : images en data URI. Même calcul que backs.ts."""
    m = models()[model_id]
    title, subtitle = title.strip()[:TITLE_MAX], subtitle.strip()[:SUBTITLE_MAX]
    with_logo = bool(m.get("title_with_logo"))
    title_on = bool(title) and (not logo or with_logo)
    sub_on = bool(subtitle) and (not logo or with_logo)
    size = min(m["title_max"], m["title_box"] / (0.62 * max(1, len(title))))
    sub_size = min(2.6, 40 / (0.55 * max(1, len(subtitle))))
    t_dy = 0.0 if with_logo else (-0.8 if sub_on else size * 0.35)
    on = lambda b: "inline" if b else "none"  # noqa: E731
    return {
        "bg": bg, "ink": ink, "title": _esc(title), "subtitle": _esc(subtitle),
        "title_size": _num(size), "sub_size": _num(sub_size), "t_dy": _num(t_dy),
        "title_on": on(title_on), "sub_on": on(sub_on), "logo_on": on(bool(logo)),
        "mark_on": on(not title and not logo and model_id != "photo"),
        "plate_on": on(title_on or bool(logo)),
        "logo": logo or PIXEL, "logo_filter": "url(#tint)" if tint and logo else "none",
        "photo": photo or PIXEL,
    }


def fill(model_id: str, values: dict[str, str]) -> str:
    return re.sub(r"\{\{(\w+)\}\}", lambda mt: values.get(mt.group(1), ""), template(model_id))


def data_uri(img: Image.Image, fmt: str = "PNG", max_px: int = 1200) -> str:
    img = ImageOps.exif_transpose(img)
    img.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    if fmt == "JPEG":
        img.convert("RGB").save(buf, "JPEG", quality=90)
    else:
        img.convert("RGBA").save(buf, "PNG", optimize=True)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def render(svg: str, width_px: int) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=width_px, dpi=96, skip_system_fonts=True, font_files=FONTS)
    return Image.open(io.BytesIO(bytes(png))).convert("RGB")
