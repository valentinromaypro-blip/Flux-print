"""Chaîne de préparation d'un fichier de commande, prêt à imposer.

PDF client → preflight → normalisation des boîtes → conversion CMJN
(profil de la presse) → PDF de production.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from .color import convert_pdf_to_cmyk
from .config import PressProfile
from .preflight import Report, Severity, run_preflight
from .products.base import DocumentSpec


def prepare_job(
    pdf_path: str | Path,
    spec: DocumentSpec,
    press: PressProfile,
    output: str | Path,
    measure_ink: bool = True,
) -> Report:
    """Renvoie le rapport de preflight ; `output` n'est écrit que si le fichier est conforme."""
    icc = press.output.icc_path if press.output.available else None
    with tempfile.TemporaryDirectory(prefix="flux-prepare-") as tmp:
        normalized = Path(tmp) / "normalized.pdf"
        report = run_preflight(pdf_path, spec, normalized_output=normalized, measure_ink=measure_ink, output_icc=icc)
        if not report.passed:
            return report
        if icc is None:
            shutil.copyfile(normalized, output)
            report.add(
                "color.not_converted",
                Severity.WARNING,
                f"Profil {press.output.identifier} absent ({press.output.icc_path}) : RVB non converti.",
            )
            return report
        conversion = convert_pdf_to_cmyk(normalized, output, icc)
        if conversion.images_converted or conversion.colors_converted:
            report.fixes.append(
                f"Conversion CMJN {press.output.identifier} : {conversion.images_converted} image(s), "
                f"{conversion.colors_converted} couleur(s) ; gris et noirs RVB en noir seul (K)."
            )
        for item in sorted(set(conversion.skipped)):
            report.add("color.partial_conversion", Severity.INFO,
                       f"Non converti ({item}) : conversion laissée au contrôleur via l'OutputIntent.")
    return report
