"""Décision de lancement des lots (amalgame automatique).

Les lignes prêtes sont regroupées par clé d'amalgame (support, format, fond
perdu, recto/verso), tous produits et toutes longueurs confondus : jeux de 54, de 32
et oracles au même format partagent les mêmes planches. Un groupe part en lot si :
- le remplissage de ses feuilles atteint le seuil ;
- ou la ligne la plus ancienne a trop attendu ;
- ou une commande est urgente (date d'expédition proche) ;
- ou le lancement est forcé (back-office).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from ..products.base import DocumentSpec
from ..production.sheet import Layout


@dataclass(frozen=True)
class BatchingRules:
    min_fill_ratio: float = 0.90
    max_wait_hours: float = 24.0
    urgent_days: int = 2
    min_sheets: int = 1
    separators: bool = True
    order: str = "deck_stack"
    # Pile = jeu (deck_stack) : en dessous de ce nombre de jeux, passage en coupe et empile compact.
    deck_stack_min_decks: int = 9
    # Piles alignées (lanes) : hauteur de coupe maximale et coûts utilisés pour choisir la hauteur.
    max_cut_sheets: int = 100
    sheet_cost: float = 0.25
    merge_cost: float = 0.03
    cut_cost: float = 1.5
    # Créneaux presse (heure de Paris) : à chaque créneau, les jeux payés avant partent en lot.
    launch_times: tuple[str, ...] = ()
    slot_min_decks: int = 1  # jeux minimum pour partir à un créneau (sinon créneau suivant)


@dataclass
class Candidate:
    gang_key: str
    media: str
    layout: Layout
    items: list[dict] = field(default_factory=list)
    specs: dict[str, DocumentSpec] = field(default_factory=dict)  # item id → spec
    pieces: int = 0
    reason: str | None = None
    decks: int = 0        # exemplaires (jeux) du lot
    deck_length: int = 0  # pièces par exemplaire (identique dans le lot en mode pile = jeu)
    preferred_order: str = "cut_stack"
    min_decks: int = 0
    lengths: list[int] = field(default_factory=list)  # pièces de chaque exemplaire
    rules: BatchingRules | None = None

    @property
    def order(self) -> str:
        """Mode d'imposition retenu pour ce lot."""
        if self.preferred_order == "deck_stack" and self.decks < self.min_decks:
            return "cut_stack"
        return self.preferred_order

    def lane_plan(self):
        from ..production.imposition import best_lane_plan

        r = self.rules or BatchingRules()
        return best_lane_plan(self.lengths, self.layout.per_sheet, r.max_cut_sheets, r.sheet_cost, r.merge_cost, r.cut_cost)

    @property
    def sheets(self) -> int:
        if not self.pieces:
            return 0
        if self.order == "lanes":
            return self.lane_plan().sheets
        if self.order == "deck_stack":  # livres de 18 jeux, du plus long au plus court
            ranked = sorted(self.lengths, reverse=True)
            return sum(ranked[i] for i in range(0, len(ranked), self.layout.per_sheet))
        return math.ceil(self.pieces / self.layout.per_sheet)

    @property
    def fill_ratio(self) -> float:
        return self.pieces / (self.sheets * self.layout.per_sheet) if self.pieces else 0.0

    @property
    def launch_fill(self) -> float:
        """Remplissage qui déclenche le lot. En pile = jeu : poses occupées par des jeux
        (17 jeux sur 18 = 94 %), pour attendre un livre plein plutôt que partir en compact."""
        if self.preferred_order == "deck_stack" and self.decks:
            per = self.layout.per_sheet
            return self.decks / (math.ceil(self.decks / per) * per)
        return self.fill_ratio


def gang_key_label(spec: DocumentSpec) -> str:
    media, sizes, bleed, duplex = spec.gang_key
    size = "+".join(f"{w:g}x{h:g}" for w, h in sizes)
    return f"{media}|{size}|{bleed:g}|{'RV' if duplex else 'R'}"


def pieces_for(item: dict, spec: DocumentSpec, separators: bool) -> int:
    return int(item["copies"]) * (len(spec.imposition_units()) + (1 if separators else 0))


def plan_batches(
    items: list[dict],
    spec_for: callable,
    layout_for: callable,
    rules: BatchingRules,
    now: datetime | None = None,
    force: bool = False,
) -> list[Candidate]:
    """Regroupe les lignes et renvoie les groupes à lancer (`reason` renseigné)."""
    now = now or datetime.now(timezone.utc)
    groups: dict[str, Candidate] = {}
    for item in items:
        spec = spec_for(item)
        key = gang_key_label(spec)
        length = len(spec.imposition_units()) + (1 if rules.separators else 0)
        if key not in groups:
            groups[key] = Candidate(key, spec.media, layout_for(spec), deck_length=length,
                                    preferred_order=rules.order, min_decks=rules.deck_stack_min_decks, rules=rules)
        group = groups[key]
        group.items.append(item)
        group.specs[str(item["id"])] = spec
        group.pieces += pieces_for(item, spec, rules.separators)
        group.decks += int(item["copies"])
        group.lengths += [length] * int(item["copies"])

    ready = []
    for group in groups.values():
        oldest = min(_as_utc(i.get("paid_at") or i["created_at"]) for i in group.items)
        waited_h = (now - oldest).total_seconds() / 3600
        dues = [i["due_date"] for i in group.items if i.get("due_date")]
        urgent = any((_as_date(d) - now.date()).days <= rules.urgent_days for d in dues)
        slot = _last_slot(rules.launch_times, now)
        if force:
            group.reason = "forcé"
        elif urgent:
            group.reason = "commande urgente"
        elif slot and oldest <= slot and group.decks >= rules.slot_min_decks:
            group.reason = f"créneau {slot.astimezone(PARIS):%H:%M}"
        elif waited_h >= rules.max_wait_hours:
            group.reason = f"attente {waited_h:.0f} h"
        elif rules.launch_times and group.order == "deck_stack" and group.decks >= group.layout.per_sheet:
            group.reason = "livre plein"
        elif rules.launch_times and group.order != "deck_stack" and group.sheets >= rules.max_cut_sheets:
            group.reason = "volume : un livre plein"
        elif not rules.launch_times and group.sheets >= rules.min_sheets and group.launch_fill >= rules.min_fill_ratio:
            group.reason = f"remplissage {group.launch_fill:.0%}"
        if group.reason:
            ready.append(group)
    return ready


PARIS = ZoneInfo("Europe/Paris")


def _last_slot(times: tuple[str, ...], now: datetime) -> datetime | None:
    """Dernier créneau presse passé (aujourd'hui, heure de Paris), ou None."""
    local = now.astimezone(PARIS)
    passed = [local.replace(hour=int(t[:2]), minute=int(t[3:5]), second=0, microsecond=0) for t in times]
    passed = [t for t in passed if t <= local]
    return max(passed) if passed else None


def _as_utc(value) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _as_date(value) -> date:
    return date.fromisoformat(value) if isinstance(value, str) else value
