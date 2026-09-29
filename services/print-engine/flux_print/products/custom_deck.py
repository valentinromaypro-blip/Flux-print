"""Produit : jeu de cartes sur mesure (oracle, cartes à thème, jeu de société…).

Le client choisit le nombre de cartes (dans les limites du produit), le format
et le mode de dos. Chaque carte a une face unique.

Convention de fichier :
- dos commun   : page 1 = dos, pages 2..N+1 = cartes 1..N ;
- dos individuels : face 1, dos 1, face 2, dos 2…
"""

from __future__ import annotations

from .base import DocumentSpec, ImpositionUnit, PageSpec, PreflightPolicy
from .playing_cards import BackLayout


def build_custom_deck_spec(
    trim_w_mm: float,
    trim_h_mm: float,
    cards: int,
    back_layout: BackLayout | str = BackLayout.COMMON,
    cards_min: int = 1,
    cards_max: int = 200,
    bleed_mm: float = 3.0,
    safe_mm: float = 4.0,
    corner_radius_mm: float = 3.5,
    media: str = "default",
    policy: PreflightPolicy | None = None,
    template: bool = False,
) -> DocumentSpec:
    """`template=True` : gabarit à une seule face modèle (le client la duplique)."""
    layout = BackLayout(back_layout)
    if not template and not cards_min <= cards <= cards_max:
        raise ValueError(f"Nombre de cartes {cards} hors limites ({cards_min} à {cards_max}).")
    count = 1 if template else cards

    def page(label: str) -> PageSpec:
        return PageSpec(label, trim_w_mm, trim_h_mm)

    face = (lambda i: "Face — modèle, à dupliquer pour chaque carte") if template else (lambda i: f"Carte {i}")
    if layout is BackLayout.COMMON:
        pages = (page("Dos (commun)"),) + tuple(page(face(i)) for i in range(1, count + 1))
        units = tuple(ImpositionUnit(f"Carte {i}", i, 0) for i in range(1, count + 1))
        order = f"{count + 1} pages : page 1 = dos commun, puis les {count} cartes dans l'ordre."
    else:
        pages = tuple(p for i in range(1, count + 1) for p in (page(face(i)), page(f"Dos {i}")))
        units = tuple(ImpositionUnit(f"Carte {i}", 2 * (i - 1), 2 * (i - 1) + 1) for i in range(1, count + 1))
        order = f"{2 * count} pages : face puis dos pour chaque carte."
    return DocumentSpec(
        code="custom-deck",
        label=f"Jeu de {cards} cartes {trim_w_mm:g} × {trim_h_mm:g} mm",
        pages=pages,
        bleed_mm=bleed_mm,
        safe_mm=safe_mm,
        corner_radius_mm=corner_radius_mm,
        policy=policy or PreflightPolicy(),
        page_order_help=order,
        media=media,
        units=units,
    )
