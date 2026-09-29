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
class ImpositionUnit:
    """Pièce physique découpée : un recto et, en recto/verso, sa page de verso.

    Les index de page sont 0-based dans le PDF source. Un dos commun est
    référencé par tous les unités (la page n'est incorporée qu'une fois).
    """

    label: str
    recto: int
    verso: int | None = None


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
    # Support d'impression : seuls des documents sur le même support
    # (et même mode recto/verso) peuvent partager une feuille.
    media: str = "default"
    # Découpage en pièces physiques ; vide = chaque page est une pièce recto seul.
    units: tuple[ImpositionUnit, ...] = ()

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def imposition_units(self) -> tuple[ImpositionUnit, ...]:
        if self.units:
            return self.units
        return tuple(ImpositionUnit(p.label, i) for i, p in enumerate(self.pages))

    @property
    def duplex(self) -> bool:
        return any(u.verso is not None for u in self.imposition_units())

    @property
    def gang_key(self) -> tuple:
        """Critère d'amalgame : même support, même format, même fond perdu, même mode."""
        sizes = {(p.trim_w_mm, p.trim_h_mm) for p in self.pages}
        return (self.media, tuple(sorted(sizes)), self.bleed_mm, self.duplex)
