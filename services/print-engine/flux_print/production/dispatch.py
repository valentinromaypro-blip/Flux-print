"""Dépôt des lots dans les dossiers surveillés (hot folders) du Fiery.

Règle atelier : SEULS des lots SRA3 préimposés entrent dans le Fiery.
Jamais de fichier client, jamais d'autre format. Avant tout dépôt, le lot est
contrôlé :
- chaque page a exactement le format de la feuille (SRA3 320 × 450 mm) ;
- aucune page pivotée ;
- PDF/X-4 avec OutputIntent (profil CMJN de la presse) ;
- recto/verso : nombre de pages pair ;
- cohérence avec le manifeste (lot, nombre de faces, support).

Chaque hot folder porte ses réglages côté Fiery (support, recto/verso petit
côté, profil) : on en configure un par couple support / mode d'impression, et
le lot est routé d'après son manifeste.

Le dépôt est atomique : écriture dans un dossier de transit sur le même disque,
puis renommage. Le Fiery ne voit jamais un fichier incomplet.
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import pikepdf

from ..units import pt_to_mm
from .pdfx import is_pdfx4
from .sheet import SheetSpec

TOLERANCE_MM = 0.1
STAGING_DIR = ".flux-transit"


class DispatchRefused(Exception):
    """Le lot ne peut pas partir au Fiery ; le message liste toutes les raisons."""


@dataclass(frozen=True)
class HotFolder:
    path: Path
    media: str
    duplex: bool


def check_press_ready(pdf_path: str | Path, sheet: SheetSpec, manifest: dict | None = None) -> list[str]:
    """Liste des problèmes bloquants (vide = lot prêt pour le Fiery)."""
    problems: list[str] = []
    try:
        pdf = pikepdf.open(pdf_path)
    except pikepdf.PdfError as exc:
        return [f"PDF illisible : {exc}"]
    with pdf:
        if not pdf.pages:
            problems.append("PDF vide.")
        for number, page in enumerate(pdf.pages, start=1):
            x0, y0, x1, y1 = (float(v) for v in page.mediabox)
            w, h = pt_to_mm(x1 - x0), pt_to_mm(y1 - y0)
            if abs(w - sheet.width_mm) > TOLERANCE_MM or abs(h - sheet.height_mm) > TOLERANCE_MM:
                problems.append(f"p.{number} : {w:.1f} × {h:.1f} mm, seul le {sheet.code} "
                                f"{sheet.width_mm:g} × {sheet.height_mm:g} mm est accepté.")
            if int(page.obj.get("/Rotate", 0)) % 360:
                problems.append(f"p.{number} : page pivotée (/Rotate).")
        if not is_pdfx4(pdf):
            problems.append("Pas un PDF/X-4 avec OutputIntent : profil CMJN de la presse absent.")
        if manifest is not None:
            if manifest.get("sheet", {}).get("code") != sheet.code:
                problems.append(f"Manifeste : feuille {manifest.get('sheet', {}).get('code')!r}, attendu {sheet.code!r}.")
            if manifest.get("impressions") != len(pdf.pages):
                problems.append(f"Manifeste : {manifest.get('impressions')} faces annoncées, {len(pdf.pages)} dans le PDF.")
            if manifest.get("duplex") and len(pdf.pages) % 2:
                problems.append("Recto/verso avec un nombre de pages impair.")
    return problems


def select_hot_folder(folders: list[HotFolder], media: str, duplex: bool) -> HotFolder:
    for folder in folders:
        if folder.media == media and folder.duplex == duplex:
            return folder
    mode = "recto/verso" if duplex else "recto"
    raise DispatchRefused(f"Aucun hot folder configuré pour le support {media!r} en {mode}.")


def dispatch(
    pdf_path: str | Path,
    manifest_path: str | Path,
    sheet: SheetSpec,
    folders: list[HotFolder],
) -> Path:
    """Contrôle puis dépose le lot et son manifeste. Renvoie le chemin déposé."""
    pdf_path = Path(pdf_path)
    manifest = json.loads(Path(manifest_path).read_text())
    problems = check_press_ready(pdf_path, sheet, manifest)
    if problems:
        raise DispatchRefused("Lot refusé pour le Fiery :\n- " + "\n- ".join(problems))
    folder = select_hot_folder(folders, manifest["media"], bool(manifest["duplex"]))
    if not folder.path.is_dir():
        raise DispatchRefused(f"Hot folder introuvable : {folder.path}")

    name = f"{manifest['batch_id']}_{sheet.code}_{manifest['media']}_{'RV' if manifest['duplex'] else 'R'}.pdf"
    target = folder.path / name
    if target.exists():
        raise DispatchRefused(f"Lot déjà déposé : {target}")
    staging = folder.path.parent / STAGING_DIR
    staging.mkdir(exist_ok=True)
    temp = staging / name
    shutil.copyfile(pdf_path, temp)
    os.replace(temp, target)  # atomique sur un même système de fichiers
    # Le manifeste reste hors du hot folder (le Fiery imprimerait tout ce qui y entre).
    archive = folder.path.parent / "manifestes"
    archive.mkdir(exist_ok=True)
    shutil.copyfile(manifest_path, archive / f"{manifest['batch_id']}.json")
    return target
