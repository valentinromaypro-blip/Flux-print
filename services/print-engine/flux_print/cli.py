"""Ligne de commande : `flux-print config | gabarit | preflight | prepare | impose | dispatch`.

Les produits et presses sont décrits dans `config/` et désignés par leur code.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import list_presses, list_products, load_press, load_product, media_options
from .pipeline import prepare_job
from .preflight import Report, Severity, run_preflight
from .production import Job, MarkStyle, SheetOrder, impose
from .production.dispatch import DispatchRefused, check_press_ready, dispatch
from .templates import generate_gabarit

_ICONS = {Severity.ERROR: "✖", Severity.WARNING: "▲", Severity.INFO: "·"}
DEFAULT_PRESS = "xerox-iridesse"


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--product", required=True, help="Code produit (voir « flux-print config »)")
    parser.add_argument("--press", default=DEFAULT_PRESS, help="Code presse")
    parser.add_argument("--media", help="Support (défaut : premier support proposé par le produit)")


def _print_report(report: Report, label: str, as_json: bool) -> None:
    if as_json:
        json.dump(report.to_dict(), sys.stdout, ensure_ascii=False, indent=2)
        print()
        return
    print(f"Produit : {label}")
    print(f"Pages : {report.page_count}")
    for finding in sorted(report.findings, key=lambda f: ["error", "warning", "info"].index(f.severity.value)):
        where = f"[p.{finding.page}] " if finding.page else ""
        print(f"  {_ICONS[finding.severity]} {where}{finding.message}")
    for fix in report.fixes:
        print(f"  ✔ Correction : {fix}")
    print("RÉSULTAT :", "CONFORME" if report.passed else "REFUSÉ")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="flux-print")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("config", help="Lister presses, feuilles et produits configurés")

    p_gab = sub.add_parser("gabarit", help="Générer le gabarit PDF client")
    _common(p_gab)
    p_gab.add_argument("output")

    for name, help_text in (("preflight", "Contrôler un PDF client"),
                            ("prepare", "Contrôler, corriger et convertir en CMJN un PDF client")):
        p = sub.add_parser(name, help=help_text)
        _common(p)
        p.add_argument("pdf")
        p.add_argument("--json", action="store_true")
        p.add_argument("--no-ink", action="store_true", help="Ne pas mesurer la couverture d'encre")
        if name == "prepare":
            p.add_argument("-o", "--output", required=True)
        else:
            p.add_argument("--normalized", help="Écrire une copie aux boîtes PDF corrigées")

    p_imp = sub.add_parser("impose", help="Amalgamer et imposer des commandes préparées")
    _common(p_imp)
    p_imp.add_argument("jobs", nargs="+", help="PDF préparés, « fichier.pdf » ou « fichier.pdf:exemplaires »")
    p_imp.add_argument("-o", "--output", required=True)
    p_imp.add_argument("--sheet", help="Code feuille (défaut : première feuille de la presse)")
    p_imp.add_argument("--manifest", help="Manifeste JSON de traçabilité")
    p_imp.add_argument("--order", default=SheetOrder.CUT_STACK.value, choices=[o.value for o in SheetOrder])
    p_imp.add_argument("--marks", default=MarkStyle.EDGE.value, choices=[m.value for m in MarkStyle])
    p_imp.add_argument("--no-separators", action="store_true")
    p_imp.add_argument("--rotation", type=int, choices=[0, 90], help="Forcer l'orientation (sens des fibres)")
    p_imp.add_argument("--batch-id")

    p_dis = sub.add_parser("dispatch", help="Contrôler un lot SRA3 et le déposer dans le hot folder du Fiery")
    p_dis.add_argument("pdf")
    p_dis.add_argument("--manifest", required=True)
    p_dis.add_argument("--press", default=DEFAULT_PRESS)
    p_dis.add_argument("--sheet")
    p_dis.add_argument("--check-only", action="store_true", help="Contrôler sans déposer")

    p_wrk = sub.add_parser("worker", help="Worker de production (contrôle, préparation, lots)")
    p_wrk.add_argument("--once", action="store_true", help="Un seul passage")
    p_wrk.add_argument("--force-batches", action="store_true", help="Lancer les lots sans attendre les seuils")
    p_wrk.add_argument("--interval", type=float, default=30.0)

    sub.add_parser("sync-catalog", help="Publier les produits configurés dans la base")

    p_ord = sub.add_parser("dev-order", help="(dev) Créer une commande avec un fichier, sans passer par le site")
    p_ord.add_argument("--product", required=True)
    p_ord.add_argument("--media")
    p_ord.add_argument("--copies", type=int, default=1)
    p_ord.add_argument("--email", default="test@flux-print.local")
    p_ord.add_argument("--paid", action="store_true", help="Marquer la commande payée")
    p_ord.add_argument("pdf")

    args = parser.parse_args(argv)

    if args.command in ("worker", "sync-catalog", "dev-order"):
        return _orders_command(args)

    if args.command == "dispatch":
        press = load_press(args.press)
        sheet = press.sheet(args.sheet)
        try:
            if args.check_only:
                problems = check_press_ready(args.pdf, sheet, json.loads(Path(args.manifest).read_text()))
                if problems:
                    raise DispatchRefused("Lot refusé pour le Fiery :\n- " + "\n- ".join(problems))
                print(f"Lot prêt pour le Fiery ({sheet.code}).")
            else:
                target = dispatch(args.pdf, args.manifest, sheet, list(press.hot_folders))
                print(f"Déposé : {target}")
        except DispatchRefused as exc:
            print(exc, file=sys.stderr)
            return 1
        return 0

    if args.command == "config":
        for code in list_presses():
            press = load_press(code)
            status = "présent" if press.output.available else f"ABSENT ({press.output.icc_path})"
            print(f"Presse {press.code} — {press.name}")
            print(f"  profil {press.output.identifier} : {status}")
            print(f"  contrôleur : {press.dfe} ; encres spéciales : {', '.join(sorted(press.specialty_inks)) or 'aucune'}")
            for sheet in press.sheets.values():
                print(f"  feuille {sheet.code} : {sheet.width_mm:g} × {sheet.height_mm:g} mm, "
                      f"marge réservée {sheet.margin_mm:g} mm, retournement {sheet.flip.value}")
        print("Produits :")
        for code in list_products():
            spec = load_product(code)
            print(f"  {code:<30} {spec.label} ({spec.page_count} p., supports {', '.join(media_options(code))})")
        return 0

    press = load_press(args.press)
    spec = load_product(args.product, press=press, media=args.media)

    if args.command == "gabarit":
        path = generate_gabarit(spec, args.output)
        print(f"Gabarit écrit : {path} ({spec.page_count} pages) — {spec.label}")
        return 0

    if args.command == "preflight":
        icc = press.output.icc_path if press.output.available else None
        report = run_preflight(args.pdf, spec, normalized_output=args.normalized,
                               measure_ink=not args.no_ink, output_icc=icc)
        _print_report(report, spec.label, args.json)
        return 0 if report.passed else 1

    if args.command == "prepare":
        report = prepare_job(args.pdf, spec, press, args.output, measure_ink=not args.no_ink)
        _print_report(report, spec.label, args.json)
        if report.passed and not args.json:
            print(f"Fichier de production : {args.output}")
        return 0 if report.passed else 1

    jobs = []
    for arg in args.jobs:
        path, _, copies = arg.partition(":")
        jobs.append(Job(Path(path).stem, Path(path), spec, int(copies or 1)))
    result = impose(
        jobs,
        args.output,
        sheet=press.sheet(args.sheet),
        order=args.order,
        separators=not args.no_separators,
        rotation=args.rotation,
        batch_id=args.batch_id,
        manifest_path=args.manifest,
        marks=args.marks,
        output_profile=press.output,
        press_name=press.name,
    )
    print(f"Lot {result.batch_id} : {result.layout.describe()} — {press.name}")
    print(f"{result.pieces} pièces sur {len(result.sheets)} feuilles "
          f"({result.manifest['impressions']} faces imprimées), remplissage {result.fill_ratio:.1%}")
    if result.manifest["pdfx4"]:
        print(f"PDF/X-4, OutputIntent {press.output.identifier} : {result.output}")
    else:
        print(f"⚠ PDF sans OutputIntent (profil {press.output.icc_path} absent) : {result.output}")
    return 0


def _orders_command(args) -> int:
    import logging
    import os
    import uuid

    from .orders.db import Database
    from .orders.files import LocalFileStore, SupabaseStorage
    from .orders.worker import Worker

    dsn = os.environ.get("FLUX_DATABASE_URL")
    if not dsn:
        print("FLUX_DATABASE_URL manquant (chaîne de connexion Postgres/Supabase).", file=sys.stderr)
        return 2
    storage = os.environ.get("FLUX_STORAGE", "supabase")
    if storage.startswith("local:"):
        files = LocalFileStore(storage.removeprefix("local:"))
    else:
        files = SupabaseStorage(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    db = Database(dsn)
    try:
        if args.command == "sync-catalog":
            from .orders.catalog import publish_catalog

            codes = publish_catalog(db, files)
            print(f"{len(codes)} produits publiés, gabarits générés.")
        elif args.command == "dev-order":
            spec = load_product(args.product, media=args.media)
            order = db.create_order(args.email)
            path = f"invites/{order['id']}/{uuid.uuid4()}.pdf"
            files.upload("uploads", path, Path(args.pdf), "application/pdf")
            item = db.add_item(order["id"], args.product, spec.media, args.copies, path)
            if args.paid:
                db.mark_paid(order["id"], "dev")
            print(f"Commande {order['number']} ({order['id']}), ligne {item['id']}"
                  f"{' — payée' if args.paid else ''}")
        else:
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
            worker = Worker(db, files)
            if args.once:
                print(worker.run_once(force_batches=args.force_batches))
            else:
                worker.run_forever(args.interval)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
