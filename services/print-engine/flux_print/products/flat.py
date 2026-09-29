"""Produit générique « à plat » : cartes de visite, cartes postales, flyers,
étiquettes, marque-pages… Une pièce = 1 page (recto) ou 2 pages (recto/verso).

Le fichier client contient les pièces à la suite : recto, verso, recto, verso…
(`pieces` > 1 pour une série de visuels différents, ex. un lot de cartes postales).
"""

from __future__ import annotations

from .base import DocumentSpec, ImpositionUnit, PageSpec, PreflightPolicy


def build_flat_spec(
    code: str,
    label: str,
    trim_w_mm: float,
    trim_h_mm: float,
    sides: int = 2,
    pieces: int = 1,
    bleed_mm: float = 3.0,
    safe_mm: float = 3.0,
    corner_radius_mm: float = 0.0,
    media: str = "default",
    policy: PreflightPolicy | None = None,
) -> DocumentSpec:
    if sides not in (1, 2):
        raise ValueError("sides doit valoir 1 (recto) ou 2 (recto/verso).")
    pages: list[PageSpec] = []
    units: list[ImpositionUnit] = []
    for i in range(pieces):
        name = f"Visuel {i + 1}" if pieces > 1 else "Pièce"
        recto = len(pages)
        pages.append(PageSpec(f"{name} — recto", trim_w_mm, trim_h_mm))
        verso = None
        if sides == 2:
            verso = len(pages)
            pages.append(PageSpec(f"{name} — verso", trim_w_mm, trim_h_mm))
        units.append(ImpositionUnit(name, recto, verso))
    order = f"{len(pages)} page(s) : " + ("recto puis verso pour chaque visuel." if sides == 2 else "un recto par visuel.")
    return DocumentSpec(
        code=code,
        label=label,
        pages=tuple(pages),
        bleed_mm=bleed_mm,
        safe_mm=safe_mm,
        corner_radius_mm=corner_radius_mm,
        policy=policy or PreflightPolicy(),
        page_order_help=order,
        media=media,
        units=tuple(units),
    )
