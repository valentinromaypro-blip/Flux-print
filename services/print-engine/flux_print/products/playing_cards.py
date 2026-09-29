"""Produit : jeu de cartes à jouer personnalisé.

Convention de fichier client (PDF déposé) :
- dos commun   : page 1 = dos, pages 2..N+1 = faces dans l'ordre canonique ;
- dos individuels : face 1, dos 1, face 2, dos 2… (recto/verso alternés).

Ordre canonique des faces : pique, cœur, carreau, trèfle ; dans chaque
couleur As, 2…10, Valet, Dame, Roi ; puis les jokers.

Les valeurs de format sont des valeurs de départ : à valider avec la
production (massicot, emporte-pièce, coins arrondis).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .base import DocumentSpec, ImpositionUnit, PageSpec, PreflightPolicy


class BackLayout(str, Enum):
    COMMON = "common"
    INDIVIDUAL = "individual"


@dataclass(frozen=True)
class CardFormat:
    code: str
    label: str
    trim_w_mm: float
    trim_h_mm: float
    bleed_mm: float = 3.0
    safe_mm: float = 4.0
    corner_radius_mm: float = 3.5


@dataclass(frozen=True)
class Card:
    code: str
    label: str


@dataclass(frozen=True)
class DeckComposition:
    code: str
    label: str
    cards: tuple[Card, ...]


FORMATS: dict[str, CardFormat] = {
    f.code: f
    for f in (
        CardFormat("poker", "Poker (63,5 × 88,9 mm)", 63.5, 88.9),
        CardFormat("bridge", "Bridge (57,2 × 88,9 mm)", 57.2, 88.9),
        CardFormat("mini", "Mini (44 × 63 mm)", 44.0, 63.0, safe_mm=3.0, corner_radius_mm=2.5),
        CardFormat("tarot", "Tarot (61 × 112 mm)", 61.0, 112.0),
    )
}

SUITS = (("S", "pique"), ("H", "cœur"), ("D", "carreau"), ("C", "trèfle"))
RANKS = (
    ("A", "As"),
    ("2", "2"),
    ("3", "3"),
    ("4", "4"),
    ("5", "5"),
    ("6", "6"),
    ("7", "7"),
    ("8", "8"),
    ("9", "9"),
    ("10", "10"),
    ("J", "Valet"),
    ("Q", "Dame"),
    ("K", "Roi"),
)
# Figures pouvant recevoir un visage (portraits à deux têtes : symétrie centrale).
COURT_RANKS = ("J", "Q", "K")


def _suit_cards(ranks: tuple[tuple[str, str], ...]) -> tuple[Card, ...]:
    return tuple(
        Card(f"{s}-{r}", f"{rl} de {sl}") for s, sl in SUITS for r, rl in ranks
    )


def _jokers(n: int) -> tuple[Card, ...]:
    return tuple(Card(f"JK-{i}", f"Joker {i}") for i in range(1, n + 1))


DECKS: dict[str, DeckComposition] = {
    d.code: d
    for d in (
        DeckComposition("54", "54 cartes (52 + 2 jokers)", _suit_cards(RANKS) + _jokers(2)),
        DeckComposition("52", "52 cartes", _suit_cards(RANKS)),
        DeckComposition(
            "32",
            "32 cartes (belote, piquet)",
            _suit_cards(tuple(r for r in RANKS if r[0] in ("A", "7", "8", "9", "10", "J", "Q", "K"))),
        ),
    )
}


def is_court_card(card: Card) -> bool:
    return card.code.split("-")[-1] in COURT_RANKS


def build_document_spec(
    format_code: str = "poker",
    deck_code: str = "54",
    back_layout: BackLayout | str = BackLayout.COMMON,
    policy: PreflightPolicy | None = None,
    media: str = "carton-jeu-310g",
) -> DocumentSpec:
    fmt = FORMATS[format_code]
    deck = DECKS[deck_code]
    layout = BackLayout(back_layout)

    def page(label: str) -> PageSpec:
        return PageSpec(label, fmt.trim_w_mm, fmt.trim_h_mm)

    if layout is BackLayout.COMMON:
        pages = (page("Dos (commun)"),) + tuple(page(f"Face — {c.label}") for c in deck.cards)
        order = (
            f"{len(pages)} pages : page 1 = dos commun, puis les {len(deck.cards)} faces "
            "(pique, cœur, carreau, trèfle ; As → Roi ; puis jokers)."
        )
        units = tuple(ImpositionUnit(c.label, i + 1, 0) for i, c in enumerate(deck.cards))
    else:
        pages = tuple(
            p for c in deck.cards for p in (page(f"Face — {c.label}"), page(f"Dos — {c.label}"))
        )
        order = (
            f"{len(pages)} pages : face puis dos pour chaque carte "
            "(pique, cœur, carreau, trèfle ; As → Roi ; puis jokers)."
        )
        units = tuple(ImpositionUnit(c.label, 2 * i, 2 * i + 1) for i, c in enumerate(deck.cards))

    return DocumentSpec(
        code=f"cards-{fmt.code}-{deck.code}-{layout.value}",
        label=f"Jeu {deck.label}, format {fmt.label}, dos {'commun' if layout is BackLayout.COMMON else 'individuels'}",
        pages=pages,
        bleed_mm=fmt.bleed_mm,
        safe_mm=fmt.safe_mm,
        corner_radius_mm=fmt.corner_radius_mm,
        policy=policy or PreflightPolicy(),
        page_order_help=order,
        media=media,
        units=units,
    )
