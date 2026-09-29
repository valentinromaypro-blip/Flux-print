"""Ligne de commande : `flux-print products | gabarit | preflight | impose`."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from .preflight import Severity, run_preflight
from .production import SHEET_32X45, Flip, Job, SheetOrder, impose
from .products.playing_cards import DECKS, FORMATS, BackLayout, build_document_spec
from .templates import generate_gabarit

_ICONS = {Severity.ERROR: "✖", Severity.WARNING: "▲", Severity.INFO: "·"}


def _add_card_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--format", default="poker", choices=sorted(FORMATS))
    parser.add_argument("--deck", default="54", choices=sorted(DECKS))
    parser.add_argument("--backs", default="common", choices=[b.value for b in BackLayout])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="flux-print")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("products", help="Lister les formats et compositions de jeux")

    p_gab = sub.add_parser("gabarit", help="Générer le gabarit PDF client")
    _add_card_options(p_gab)
    p_gab.add_argument("output")

    p_pre = sub.add_parser("preflight", help="Contrôler un PDF client")
    _add_card_options(p_pre)
    p_pre.add_argument("pdf")
    p_pre.add_argument("--json", action="store_true", help="Rapport JSON")
    p_pre.add_argument("--normalized", help="Écrire une copie corrigée (boîtes PDF)")
    p_pre.add_argument("--no-ink", action="store_true", help="Ne pas mesurer la couverture d'encre")
    p_pre.add_argument("--icc", help="Profil CMJN de la presse pour la mesure d'encre")

    p_imp = sub.add_parser("impose", help="Amalgamer et imposer des commandes sur feuille 32 × 45")
    _add_card_options(p_imp)
    p_imp.add_argument("jobs", nargs="+", help="PDF conformes, « fichier.pdf » ou « fichier.pdf:exemplaires »")
    p_imp.add_argument("-o", "--output", required=True)
    p_imp.add_argument("--manifest", help="Manifeste JSON de traçabilité")
    p_imp.add_argument("--order", default=SheetOrder.CUT_STACK.value, choices=[o.value for o in SheetOrder])
    p_imp.add_argument("--no-separators", action="store_true")
    p_imp.add_argument("--flip", default=Flip.LONG_EDGE.value, choices=[f.value for f in Flip])
    p_imp.add_argument("--rotation", type=int, choices=[0, 90], help="Forcer l'orientation (sens des fibres)")
    p_imp.add_argument("--batch-id")

    args = parser.parse_args(argv)

    if args.command == "products":
        print("Formats :")
        for f in FORMATS.values():
            print(f"  {f.code:<8} {f.label} — fond perdu {f.bleed_mm:g} mm, sécurité {f.safe_mm:g} mm")
        print("Jeux :")
        for d in DECKS.values():
            print(f"  {d.code:<8} {d.label}")
        return 0

    spec = build_document_spec(args.format, args.deck, args.backs)

    if args.command == "gabarit":
        path = generate_gabarit(spec, args.output)
        print(f"Gabarit écrit : {path} ({spec.page_count} pages) — {spec.label}")
        return 0

    if args.command == "impose":
        jobs = []
        for arg in args.jobs:
            path, _, copies = arg.partition(":")
            jobs.append(Job(Path(path).stem, Path(path), spec, int(copies or 1)))
        result = impose(
            jobs,
            args.output,
            sheet=replace(SHEET_32X45, flip=Flip(args.flip)),
            order=args.order,
            separators=not args.no_separators,
            rotation=args.rotation,
            batch_id=args.batch_id,
            manifest_path=args.manifest,
        )
        print(f"Lot {result.batch_id} : {result.layout.describe()}")
        print(f"{result.pieces} pièces sur {len(result.sheets)} feuilles "
              f"({result.manifest['impressions']} faces imprimées), remplissage {result.fill_ratio:.1%}")
        print(f"PDF : {result.output}")
        return 0

    report = run_preflight(
        args.pdf,
        spec,
        normalized_output=args.normalized,
        measure_ink=not args.no_ink,
        output_icc=args.icc,
    )
    if args.json:
        json.dump(report.to_dict(), sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        print(f"Produit : {spec.label}")
        print(f"Pages : {report.page_count}/{spec.page_count}")
        for finding in sorted(report.findings, key=lambda f: ["error", "warning", "info"].index(f.severity.value)):
            where = f"[p.{finding.page}] " if finding.page else ""
            print(f"  {_ICONS[finding.severity]} {where}{finding.message}")
        for fix in report.fixes:
            print(f"  ✔ Correction : {fix}")
        print("RÉSULTAT :", "CONFORME" if report.passed else "REFUSÉ")
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
