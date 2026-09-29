"""Mesure de la couverture d'encre totale (TAC) par rendu CMJN.

Utilise Ghostscript en processus externe s'il est installé (licence AGPL :
appelé tel quel en ligne de commande, jamais lié au code). Sans Ghostscript,
la mesure est simplement sautée.

Le TAC s'évalue sur une zone, pas sur un pixel isolé : la valeur retenue est
le maximum des moyennes par blocs (≈ 1,5 mm à 50 dpi, bloc de 3 px).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def ghostscript_path() -> str | None:
    return shutil.which("gs") or shutil.which("gswin64c")


def measure_tac(
    pdf_path: str | Path,
    dpi: int = 50,
    block: int = 3,
    output_icc: str | Path | None = None,
    timeout_s: int = 600,
) -> list[float] | None:
    """TAC maximal (en %) de chaque page, ou None si Ghostscript est absent.

    `output_icc` : profil CMJN de la presse, pour que la séparation du
    contenu RVB reflète la production (sinon profil par défaut de Ghostscript).
    """
    gs = ghostscript_path()
    if gs is None:
        return None
    with tempfile.TemporaryDirectory(prefix="flux-tac-") as tmp:
        cmd = [
            gs,
            "-q",
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-sDEVICE=tiff32nc",
            f"-r{dpi}",
            f"-sOutputFile={tmp}/p-%04d.tif",
        ]
        if output_icc:
            cmd.append(f"-sOutputICCProfile={output_icc}")
        cmd.append(str(pdf_path))
        subprocess.run(cmd, check=True, capture_output=True, timeout=timeout_s)
        results = []
        for tif in sorted(Path(tmp).glob("p-*.tif")):
            with Image.open(tif) as im:
                arr = np.asarray(im.convert("CMYK"), dtype=np.float32)
            total = arr.sum(axis=2) * (100.0 / 255.0)
            h, w = total.shape
            h2, w2 = h // block * block, w // block * block
            if h2 and w2:
                total = total[:h2, :w2].reshape(h2 // block, block, w2 // block, block).mean(axis=(1, 3))
            results.append(float(total.max()) if total.size else 0.0)
        return results
