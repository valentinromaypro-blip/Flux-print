"""Génération des gabarits PDF téléchargeables par les clients.

Une page par page attendue, au format fini + fond perdu, avec :
- la zone de fond perdu teintée ;
- le trait de coupe (coins arrondis le cas échéant) ;
- la zone de sécurité ;
- le nom de la page (ex. « Face — Roi de cœur »).

Tous les repères sont tracés dans un ton direct dédié (`policy.guide_spot_name`) :
si le client exporte son fichier sans masquer le gabarit, le preflight le détecte.
TrimBox et BleedBox sont posées pour que les logiciels de PAO les reprennent.
"""

from __future__ import annotations

from pathlib import Path

import pikepdf
from reportlab.lib.colors import CMYKColorSep
from reportlab.pdfgen import canvas

from ..products.base import DocumentSpec
from ..units import mm_to_pt


def _guide(spec: DocumentSpec, density: float) -> CMYKColorSep:
    return CMYKColorSep(0, 1, 0, 0, spotName=spec.policy.guide_spot_name, density=density)


def generate_gabarit(spec: DocumentSpec, output: str | Path) -> Path:
    output = Path(output)
    bleed = mm_to_pt(spec.bleed_mm)
    safe = mm_to_pt(spec.safe_mm)
    radius = mm_to_pt(spec.corner_radius_mm)

    c = canvas.Canvas(str(output))
    c.setTitle(f"Gabarit — {spec.label}")
    c.setAuthor("Flux-print")
    boxes: list[tuple[list[float], list[float]]] = []

    for page in spec.pages:
        tw, th = mm_to_pt(page.trim_w_mm), mm_to_pt(page.trim_h_mm)
        pw, ph = tw + 2 * bleed, th + 2 * bleed
        c.setPageSize((pw, ph))

        # Zone de fond perdu (anneau entre le bord du média et la coupe).
        c.setFillColor(_guide(spec, 0.15))
        path = c.beginPath()
        path.rect(0, 0, pw, ph)
        path.rect(bleed, bleed, tw, th)
        c.drawPath(path, stroke=0, fill=1, fillMode=1)  # 1 = pair-impair

        # Trait de coupe.
        c.setStrokeColor(_guide(spec, 1.0))
        c.setLineWidth(0.5)
        if radius > 0:
            c.roundRect(bleed, bleed, tw, th, radius, stroke=1, fill=0)
        else:
            c.rect(bleed, bleed, tw, th, stroke=1, fill=0)

        # Zone de sécurité.
        c.setStrokeColor(_guide(spec, 0.6))
        c.setDash(2, 2)
        c.rect(bleed + safe, bleed + safe, tw - 2 * safe, th - 2 * safe, stroke=1, fill=0)
        c.setDash()

        # Libellés.
        c.setFillColor(_guide(spec, 1.0))
        c.setFont("Helvetica", 4.5)
        c.drawCentredString(pw / 2, ph - bleed + 2.5, f"Fond perdu {spec.bleed_mm:g} mm")
        c.drawCentredString(pw / 2, bleed + safe + 2, f"Zone de sécurité {spec.safe_mm:g} mm")
        c.setFillColor(_guide(spec, 0.5))
        c.setFont("Helvetica-Bold", 8)
        words = page.label.split(" — ")
        y = ph / 2 + 5 * (len(words) - 1)
        for word in words:
            c.drawCentredString(pw / 2, y, word)
            y -= 10
        c.setFont("Helvetica", 4.5)
        c.drawCentredString(pw / 2, ph / 2 - 10 * len(words) - 2, "Masquer ce gabarit avant l'export")

        boxes.append(
            ([bleed, bleed, bleed + tw, bleed + th], [0, 0, pw, ph]),
        )
        c.showPage()
    c.save()

    with pikepdf.open(output, allow_overwriting_input=True) as pdf:
        for page, (trim, bleed_box) in zip(pdf.pages, boxes):
            page.obj["/TrimBox"] = pikepdf.Array(trim)
            page.obj["/BleedBox"] = pikepdf.Array(bleed_box)
        pdf.save(output)
    return output
