"""Chargement de la configuration : presses, feuilles et produits (fichiers TOML).

Le moteur ne contient aucune valeur propre à un produit ou à une machine :
ajouter un produit ou une presse = ajouter un fichier dans `config/`.

Emplacement : variable d'environnement `FLUX_PRINT_CONFIG`, sinon `config/`
à la racine du service.
"""

from __future__ import annotations

import dataclasses
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .production.sheet import Flip, SheetSpec
from .products.base import DocumentSpec, PreflightPolicy
from .products.flat import build_flat_spec
from .products.playing_cards import build_document_spec as build_playing_cards

DEFAULT_BLEED_MM = 3.0


def config_dir() -> Path:
    env = os.environ.get("FLUX_PRINT_CONFIG")
    return Path(env) if env else Path(__file__).resolve().parent.parent / "config"


@dataclass(frozen=True)
class OutputProfile:
    """Condition d'impression déclarée dans les PDF (OutputIntent)."""

    icc_path: Path
    identifier: str
    condition: str
    registry: str = "http://www.color.org"

    @property
    def available(self) -> bool:
        return self.icc_path.is_file()


@dataclass(frozen=True)
class PressProfile:
    code: str
    name: str
    dfe: str
    flip: Flip
    specialty_inks: frozenset[str]
    registration_tolerance_mm: float
    output: OutputProfile
    sheets: dict[str, SheetSpec]

    def sheet(self, code: str | None = None) -> SheetSpec:
        if code is None:
            return next(iter(self.sheets.values()))
        return self.sheets[code]


def _read(path: Path) -> dict[str, Any]:
    with path.open("rb") as fh:
        return tomllib.load(fh)


def list_presses() -> list[str]:
    return sorted(p.stem for p in (config_dir() / "presses").glob("*.toml"))


def load_press(code: str) -> PressProfile:
    base = config_dir()
    data = _read(base / "presses" / f"{code}.toml")
    flip = Flip(data.get("duplex_flip", Flip.LONG_EDGE.value))
    out = data["output"]
    icc = Path(out["icc_profile"])
    sheets = {
        s["code"]: SheetSpec(
            code=s["code"],
            width_mm=float(s["width_mm"]),
            height_mm=float(s["height_mm"]),
            margin_mm=float(s.get("reserved_margin_mm", 10.0)),
            flip=flip,
        )
        for s in data["sheets"]
    }
    return PressProfile(
        code=data["code"],
        name=data["name"],
        dfe=data.get("dfe", ""),
        flip=flip,
        specialty_inks=frozenset(data.get("specialty_inks", [])),
        registration_tolerance_mm=float(data.get("registration_tolerance_mm", 0.5)),
        output=OutputProfile(
            icc_path=icc if icc.is_absolute() else base / icc,
            identifier=out["output_condition_identifier"],
            condition=out.get("output_condition", ""),
            registry=out.get("registry", "http://www.color.org"),
        ),
        sheets=sheets,
    )


# --- Produits -----------------------------------------------------------------

ProductBuilder = Callable[[dict[str, Any], str, PreflightPolicy], DocumentSpec]


def _playing_cards(params: dict[str, Any], media: str, policy: PreflightPolicy) -> DocumentSpec:
    return build_playing_cards(
        params.get("format", "poker"), str(params.get("deck", "54")), params.get("backs", "common"),
        policy=policy, media=media,
    )


def _flat(params: dict[str, Any], media: str, policy: PreflightPolicy) -> DocumentSpec:
    w, h = params["trim_mm"]
    return build_flat_spec(
        code="flat", label="", trim_w_mm=float(w), trim_h_mm=float(h),
        sides=int(params.get("sides", 2)), pieces=int(params.get("pieces", 1)),
        bleed_mm=float(params.get("bleed_mm", DEFAULT_BLEED_MM)), safe_mm=float(params.get("safe_mm", 3.0)),
        corner_radius_mm=float(params.get("corner_radius_mm", 0.0)), media=media, policy=policy,
    )


# Types de produits connus. Un nouveau type (livre, calendrier…) = une fonction ici.
PRODUCT_TYPES: dict[str, ProductBuilder] = {
    "playing_cards": _playing_cards,
    "flat": _flat,
}


def list_products() -> list[str]:
    return sorted(p.stem for p in (config_dir() / "products").glob("*.toml"))


def load_product(code: str, press: PressProfile | None = None, **overrides: Any) -> DocumentSpec:
    """Construit la spec d'un produit ; la presse fournit les encres spéciales acceptées."""
    data = _read(config_dir() / "products" / f"{code}.toml")
    params = {**data.get("params", {}), **overrides}
    policy = PreflightPolicy(**data.get("preflight", {}))
    if press is not None:
        policy = dataclasses.replace(policy, allowed_spot_names=press.specialty_inks)
    builder = PRODUCT_TYPES[data["type"]]
    spec = builder(params, data.get("media", "default"), policy)
    if spec.bleed_mm != DEFAULT_BLEED_MM and not data.get("allow_custom_bleed", False):
        raise ValueError(f"{code} : fond perdu de {spec.bleed_mm} mm, la règle atelier est {DEFAULT_BLEED_MM} mm.")
    return dataclasses.replace(spec, code=data["code"], label=data.get("label", spec.label))
