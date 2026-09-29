"""Spécification générique d'un document imprimable.

Chaque produit (jeu de cartes, livre…) se traduit en `DocumentSpec` :
le preflight et les gabarits ne connaissent que cette structure, ce qui
permet d'ajouter une nouvelle niche sans toucher au moteur.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PreflightPolicy:
    """Seuils de contrôle. À caler sur les machines et supports de l'atelier."""

    min_ppi_error: float = 150.0
    min_ppi_warning: float = 250.0
    max_tac_percent: float = 320.0
    min_line_width_pt: float = 0.25
    geometry_tolerance_mm: float = 0.5
    # RVB accepté mais signalé : il sera converti avec le profil de production.
    allow_rgb: bool = True
    # Tons directs non prévus au produit : bloquants par défaut.
    allow_spot_colors: bool = False
    # Couleur d'accompagnement utilisée par nos gabarits pour les repères.
    # Sa présence dans un fichier client signifie que les repères n'ont pas été retirés.
    guide_spot_name: str = "FLUX-GUIDE"


@dataclass(frozen=True)
class PageSpec:
    """Une page attendue : rôle lisible et format fini (portrait)."""

    label: str
    trim_w_mm: float
    trim_h_mm: float


@dataclass(frozen=True)
class DocumentSpec:
    code: str
    label: str
    pages: tuple[PageSpec, ...]
    bleed_mm: float
    safe_mm: float
    corner_radius_mm: float = 0.0
    policy: PreflightPolicy = field(default_factory=PreflightPolicy)
    # Description de l'ordre des pages, affichée au client en cas d'erreur.
    page_order_help: str = ""

    @property
    def page_count(self) -> int:
        return len(self.pages)
