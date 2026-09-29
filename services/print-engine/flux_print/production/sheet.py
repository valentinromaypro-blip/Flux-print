"""Feuille machine et calcul de la grille de pose (step-and-repeat).

Format de référence de l'atelier : SRA3 32 × 45 cm, impression numérique
(les feuilles disponibles sont décrites par presse dans `config/presses`).

Deux styles de traits de coupe :
- EDGE (défaut) : pièces fond perdu contre fond perdu, traits de coupe
  prolongés en bordure de grille, à chaque ligne de coupe. En pose
  régulière, chaque coupe traverse la feuille : c'est ce qu'il faut
  pour le massicot, et chaque pièce a ses traits de coupe ;
- PER_PIECE : un écart est ménagé entre les pièces pour tracer les
  traits de coupe de chaque pièce à ses propres coins. Nécessaire pour
  une coupe pièce par pièce ; coûte des poses.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..units import mm_to_pt


class MarkStyle(str, Enum):
    EDGE = "edge"
    PER_PIECE = "per_piece"


# Traits de coupe : longueur et écart par rapport à la zone de fond perdu.
MARK_LENGTH_MM = 4.0
MARK_OFFSET_MM = 1.5


class Flip(str, Enum):
    """Retournement du recto/verso de la presse."""

    LONG_EDGE = "long_edge"  # la feuille tourne autour de son grand côté
    SHORT_EDGE = "short_edge"  # la feuille tourne autour de son petit côté


@dataclass(frozen=True)
class SheetSpec:
    code: str
    width_mm: float
    height_mm: float
    # Marge réservée sur chaque bord : zone non imprimable de la presse
    # + repères de coupe, marques de découpe numérique, identification.
    margin_mm: float = 10.0
    flip: Flip = Flip.LONG_EDGE

    @property
    def width_pt(self) -> float:
        return mm_to_pt(self.width_mm)

    @property
    def height_pt(self) -> float:
        return mm_to_pt(self.height_mm)


SRA3 = SheetSpec("SRA3", 320.0, 450.0)
SHEET_32X45 = SRA3  # alias historique


@dataclass(frozen=True)
class Slot:
    """Emplacement d'une pièce sur le recto : rectangle fond perdu compris (pt)."""

    index: int
    x: float
    y: float
    w: float
    h: float
    rotation: int  # rotation du contenu, en degrés anti-horaires (0 ou 90)
    trim_inset: float  # fond perdu (pt), pour retrouver le trait de coupe

    @property
    def trim(self) -> tuple[float, float, float, float]:
        d = self.trim_inset
        return (self.x + d, self.y + d, self.x + self.w - d, self.y + self.h - d)

    def verso(self, sheet: SheetSpec) -> "Slot":
        """Même pièce vue au verso, selon le mode de retournement."""
        if sheet.flip is Flip.LONG_EDGE:
            return Slot(self.index, sheet.width_pt - self.x - self.w, self.y, self.w, self.h,
                        (-self.rotation) % 360, self.trim_inset)
        return Slot(self.index, self.x, sheet.height_pt - self.y - self.h, self.w, self.h,
                    (180 - self.rotation) % 360, self.trim_inset)


@dataclass(frozen=True)
class Layout:
    sheet: SheetSpec
    cols: int
    rows: int
    rotation: int
    slots: tuple[Slot, ...]
    marks: MarkStyle = MarkStyle.EDGE

    @property
    def per_sheet(self) -> int:
        return len(self.slots)

    def describe(self) -> str:
        turn = ", pivotées 90°" if self.rotation else ""
        return f"{self.per_sheet} poses ({self.cols} × {self.rows}{turn}) sur {self.sheet.code}"


def compute_layout(
    sheet: SheetSpec,
    trim_w_mm: float,
    trim_h_mm: float,
    bleed_mm: float,
    gap_mm: float | None = None,
    rotation: int | None = None,
    marks: MarkStyle = MarkStyle.EDGE,
) -> Layout:
    """Grille maximisant le nombre de poses.

    `rotation` force l'orientation (0 ou 90) : utile pour respecter le sens
    des fibres du support. À nombre de poses égal, 0° est préféré.
    """
    marks = MarkStyle(marks)
    if gap_mm is None:
        gap_mm = MARK_LENGTH_MM if marks is MarkStyle.PER_PIECE else 0.0
    avail_w = sheet.width_mm - 2 * sheet.margin_mm
    avail_h = sheet.height_mm - 2 * sheet.margin_mm
    candidates = []
    for rot in ((0, 90) if rotation is None else (rotation,)):
        w, h = (trim_w_mm, trim_h_mm) if rot == 0 else (trim_h_mm, trim_w_mm)
        step_w, step_h = w + 2 * bleed_mm, h + 2 * bleed_mm
        cols = int((avail_w + gap_mm) // (step_w + gap_mm))
        rows = int((avail_h + gap_mm) // (step_h + gap_mm))
        candidates.append((cols * rows, -rot, rot, cols, rows, step_w, step_h))
    count, _, rot, cols, rows, step_w, step_h = max(candidates)
    if count == 0:
        raise ValueError(f"La pièce {trim_w_mm} × {trim_h_mm} mm ne tient pas sur la feuille {sheet.code}.")

    grid_w = cols * step_w + (cols - 1) * gap_mm
    grid_h = rows * step_h + (rows - 1) * gap_mm
    x0 = (sheet.width_mm - grid_w) / 2
    y_top = (sheet.height_mm + grid_h) / 2
    slots = []
    # Ordre de lecture : de haut en bas, de gauche à droite.
    for r in range(rows):
        for c in range(cols):
            x = x0 + c * (step_w + gap_mm)
            y = y_top - (r + 1) * step_h - r * gap_mm
            slots.append(
                Slot(len(slots), mm_to_pt(x), mm_to_pt(y), mm_to_pt(step_w), mm_to_pt(step_h), rot, mm_to_pt(bleed_mm))
            )
    return Layout(sheet, cols, rows, rot, tuple(slots), marks)
