"""Preflight d'un PDF déposé par un client, contrôlé contre un `DocumentSpec`.

Ordre des contrôles :
1. lisibilité du fichier (chiffrement, corruption) ;
2. nombre de pages ;
3. géométrie par page (format fini, fond perdu, orientation) ;
4. contenu (images, couleurs, filets, polices, transparence) ;
5. texte hors zone de sécurité (positions exactes des glyphes via PDFium) ;
6. couverture d'encre (rendu CMJN, si Ghostscript est disponible).

Corrections automatiques sans perte (option `normalized_output`) :
pose des TrimBox/BleedBox quand elles peuvent être déduites sans ambiguïté.
"""

from __future__ import annotations

import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium

from ..products.base import DocumentSpec
from ..units import mm_to_pt, pt_to_mm
from .report import Report, Severity
from .scanner import font_is_embedded, font_name, inherited, scan_page
from .tac import measure_tac

Rect = tuple[float, float, float, float]  # x0, y0, x1, y1 en points


def _rect(values) -> Rect:
    x0, y0, x1, y1 = (float(v) for v in values)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _size_mm(r: Rect) -> tuple[float, float]:
    return pt_to_mm(r[2] - r[0]), pt_to_mm(r[3] - r[1])


def _inset(r: Rect, d: float) -> Rect:
    return (r[0] + d, r[1] + d, r[2] - d, r[3] - d)


def _intersect(a: Rect, b: Rect) -> Rect:
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def _pages_label(pages: list[int]) -> str:
    if len(pages) > 8:
        return f"{len(pages)} pages ({', '.join(map(str, pages[:6]))}…)"
    return "page " + ", ".join(map(str, pages)) if len(pages) == 1 else "pages " + ", ".join(map(str, pages))


@dataclass
class _Geometry:
    trim: Rect
    fix_boxes: tuple[Rect, Rect] | None = None  # (TrimBox, BleedBox) à poser


def run_preflight(
    pdf_path: str | Path,
    spec: DocumentSpec,
    normalized_output: str | Path | None = None,
    measure_ink: bool = True,
    output_icc: str | Path | None = None,
) -> Report:
    report = Report(spec_code=spec.code)
    policy = spec.policy

    try:
        pdf = pikepdf.open(pdf_path)
    except pikepdf.PasswordError:
        report.add("file.encrypted", Severity.ERROR, "Le PDF est protégé par un mot de passe.")
        return report
    except pikepdf.PdfError as exc:
        report.add("file.unreadable", Severity.ERROR, "Le fichier n'est pas un PDF lisible.", error=str(exc))
        return report

    with pdf:
        report.page_count = len(pdf.pages)
        if report.page_count != spec.page_count:
            report.add(
                "pages.count",
                Severity.ERROR,
                f"{report.page_count} page(s) reçue(s), {spec.page_count} attendue(s). {spec.page_order_help}",
                expected=spec.page_count,
                actual=report.page_count,
            )

        grouped: dict[str, list[int]] = defaultdict(list)
        spot_names: set[str] = set()
        specialty_inks: set[str] = set()
        fonts_seen: dict[str, tuple[int, pikepdf.Object]] = {}
        geometries: dict[int, _Geometry] = {}

        for index, page in enumerate(pdf.pages):
            number = index + 1
            page_spec = spec.pages[index] if index < spec.page_count else None

            if page_spec is not None:
                geom = _check_geometry(report, page, number, page_spec.trim_w_mm, page_spec.trim_h_mm, spec)
                if geom is not None:
                    geometries[number] = geom

            if "/Annots" in page.obj and len(page.obj["/Annots"]) > 0:
                grouped["content.annotations"].append(number)

            scan = scan_page(page)

            for img in scan.images:
                if img.is_mask:
                    continue
                ppi = img.effective_ppi
                if ppi < policy.min_ppi_error:
                    severity = Severity.ERROR
                elif ppi < policy.min_ppi_warning:
                    severity = Severity.WARNING
                else:
                    continue
                report.add(
                    "image.resolution",
                    severity,
                    f"Image en {ppi:.0f} ppi à la taille d'impression "
                    f"(minimum {policy.min_ppi_error:.0f}, recommandé {policy.min_ppi_warning:.0f}).",
                    page=number,
                    ppi=round(ppi, 1),
                    pixels=[img.width_px, img.height_px],
                    placed_mm=[round(pt_to_mm(img.placed_w_pt), 1), round(pt_to_mm(img.placed_h_pt), 1)],
                )

            if "RGB" in scan.colorspaces:
                grouped["color.rgb"].append(number)
            if "Lab" in scan.colorspaces:
                grouped["color.lab"].append(number)
            if policy.guide_spot_name in scan.spot_names:
                grouped["content.guide_marks"].append(number)
            special = scan.spot_names & policy.allowed_spot_names
            if special:
                specialty_inks |= special
                grouped["color.specialty_ink"].append(number)
            page_spots = scan.spot_names - {policy.guide_spot_name} - policy.allowed_spot_names
            if page_spots:
                spot_names |= page_spots
                grouped["color.spot"].append(number)
            if scan.uses_transparency:
                grouped["content.transparency"].append(number)
            if scan.uses_overprint:
                grouped["content.overprint"].append(number)
            thin = [w for w in scan.stroke_widths_pt if w < policy.min_line_width_pt]
            if thin:
                grouped["content.hairline"].append(number)

            for key, font in scan.fonts.items():
                fonts_seen.setdefault(key, (number, font))

        _emit_grouped(report, grouped, spot_names, spec, specialty_inks)

        for number, font in fonts_seen.values():
            if not font_is_embedded(font):
                report.add(
                    "font.not_embedded",
                    Severity.ERROR,
                    f"Police non incorporée : {font_name(font)}. Exportez en incorporant les polices "
                    "ou vectorisez le texte.",
                    page=number,
                    font=font_name(font),
                )

        if "/OutputIntents" not in pdf.Root:
            report.add(
                "color.no_output_intent",
                Severity.INFO,
                "Pas de profil de sortie (OutputIntent) : le profil de production de l'atelier sera appliqué.",
            )

        fixes = {n: g.fix_boxes for n, g in geometries.items() if g.fix_boxes}
        if normalized_output is not None:
            for number, (trim, bleed) in fixes.items():
                page = pdf.pages[number - 1]
                page.obj["/TrimBox"] = pikepdf.Array(trim)
                page.obj["/BleedBox"] = pikepdf.Array(bleed)
            if fixes:
                report.fixes.append(f"TrimBox/BleedBox posées sur {_pages_label(sorted(fixes))}.")
            pdf.save(normalized_output)

    _check_text_safe_zone(report, pdf_path, geometries, spec)

    if measure_ink:
        _check_tac(report, pdf_path, spec, output_icc)

    return report


def _check_geometry(report: Report, page: pikepdf.Page, number: int, w_mm: float, h_mm: float, spec: DocumentSpec):
    tol = spec.policy.geometry_tolerance_mm
    bleed = spec.bleed_mm
    media = _rect(inherited(page.obj, "/MediaBox"))
    rotate = int(inherited(page.obj, "/Rotate") or 0) % 360
    if rotate in (90, 270):
        # On compare dans l'espace non pivoté de la page.
        w_mm, h_mm = h_mm, w_mm

    def close(a: float, b: float) -> bool:
        return abs(a - b) <= tol

    def matches(size: tuple[float, float], w: float, h: float) -> bool:
        return close(size[0], w) and close(size[1], h)

    if "/TrimBox" in page.obj:
        trim = _rect(page.obj["/TrimBox"])
        size = _size_mm(trim)
        if not matches(size, w_mm, h_mm):
            if matches(size, h_mm, w_mm):
                report.add("geometry.orientation", Severity.ERROR, "Page en paysage, portrait attendu.", page=number)
            else:
                report.add(
                    "geometry.trim_size",
                    Severity.ERROR,
                    f"Format fini {size[0]:.1f} × {size[1]:.1f} mm, attendu {w_mm:.1f} × {h_mm:.1f} mm.",
                    page=number,
                    actual_mm=[round(size[0], 2), round(size[1], 2)],
                )
            return None
        outer = _intersect(_rect(page.obj["/BleedBox"]), media) if "/BleedBox" in page.obj else media
        available = pt_to_mm(min(trim[0] - outer[0], trim[1] - outer[1], outer[2] - trim[2], outer[3] - trim[3]))
        if available < bleed - tol:
            _bleed_error(report, number, available, bleed)
        return _Geometry(trim=trim)

    size = _size_mm(media)
    dx, dy = size[0] - w_mm, size[1] - h_mm
    if matches(size, w_mm, h_mm):
        _bleed_error(report, number, 0.0, bleed)
        return _Geometry(trim=media)
    if abs(dx - dy) <= tol and dx / 2 >= bleed - tol:
        margin = mm_to_pt(dx / 2)
        trim = _inset(media, margin)
        bleed_box = _intersect(_inset(trim, -mm_to_pt(bleed)), media)
        if abs(dx / 2 - bleed) > tol:
            report.add(
                "geometry.trim_inferred",
                Severity.WARNING,
                f"Pas de TrimBox : format fini déduit centré, fond perdu de {dx / 2:.1f} mm.",
                page=number,
            )
        return _Geometry(trim=trim, fix_boxes=(trim, bleed_box))
    if matches(size, h_mm, w_mm) or matches(size, h_mm + 2 * bleed, w_mm + 2 * bleed):
        report.add("geometry.orientation", Severity.ERROR, "Page en paysage, portrait attendu.", page=number)
        return None
    report.add(
        "geometry.page_size",
        Severity.ERROR,
        f"Page de {size[0]:.1f} × {size[1]:.1f} mm, attendu {w_mm + 2 * bleed:.1f} × {h_mm + 2 * bleed:.1f} mm "
        f"(format fini {w_mm:.1f} × {h_mm:.1f} + {bleed:.0f} mm de fond perdu).",
        page=number,
        actual_mm=[round(size[0], 2), round(size[1], 2)],
    )
    return None


def _bleed_error(report: Report, number: int, available: float, required: float) -> None:
    if available <= 0.05:
        message = f"Aucun fond perdu : {required:.0f} mm requis de chaque côté."
    else:
        message = f"Fond perdu insuffisant : {available:.1f} mm, {required:.0f} mm requis."
    report.add("geometry.bleed", Severity.ERROR, message, page=number, available_mm=round(available, 2))


_GROUPED_MESSAGES = {
    "color.lab": (Severity.WARNING, "Couleurs Lab : converties en CMJN avec le profil de production."),
    "content.guide_marks": (
        Severity.ERROR,
        "Les repères du gabarit (fond perdu, coupe, zone de sécurité) sont encore présents : "
        "masquez le calque du gabarit avant l'export.",
    ),
    "content.transparency": (Severity.INFO, "Transparences présentes (gérées en PDF/X-4)."),
    "content.overprint": (Severity.WARNING, "Surimpression activée : vérifiez qu'elle est volontaire."),
    "content.annotations": (Severity.WARNING, "Annotations ou champs de formulaire présents : ils ne seront pas imprimés."),
}


def _emit_grouped(
    report: Report, grouped: dict[str, list[int]], spot_names: set[str], spec: DocumentSpec, specialty_inks: set[str]
) -> None:
    policy = spec.policy
    for code, pages in grouped.items():
        where = _pages_label(pages)
        if code == "color.rgb":
            severity = Severity.WARNING if policy.allow_rgb else Severity.ERROR
            report.add(
                code,
                severity,
                f"Éléments en RVB ({where}) : ils seront convertis en CMJN, les couleurs vives peuvent ternir.",
                pages=pages,
            )
        elif code == "color.spot":
            severity = Severity.WARNING if policy.allow_spot_colors else Severity.ERROR
            report.add(
                code,
                severity,
                f"Tons directs non prévus ({', '.join(sorted(spot_names))}) sur {where}.",
                pages=pages,
                spots=sorted(spot_names),
            )
        elif code == "color.specialty_ink":
            report.add(
                code,
                Severity.INFO,
                f"Encres spéciales utilisées ({', '.join(sorted(specialty_inks))}) sur {where}.",
                pages=pages,
                inks=sorted(specialty_inks),
            )
        elif code == "content.hairline":
            report.add(
                code,
                Severity.WARNING,
                f"Filets inférieurs à {policy.min_line_width_pt} pt ({where}) : risque de disparition à l'impression.",
                pages=pages,
            )
        else:
            severity, message = _GROUPED_MESSAGES[code]
            report.add(code, severity, f"{message} ({where})", pages=pages)


def _check_text_safe_zone(report: Report, pdf_path, geometries: dict[int, _Geometry], spec: DocumentSpec) -> None:
    if spec.safe_mm <= 0 or not geometries:
        return
    safe_inset = mm_to_pt(spec.safe_mm)
    try:
        doc = pdfium.PdfDocument(str(pdf_path))
    except pdfium.PdfiumError:
        return
    try:
        for number, geom in geometries.items():
            if number > len(doc):
                continue
            page = doc[number - 1]
            textpage = page.get_textpage()
            safe = _inset(geom.trim, safe_inset)
            outside: list[str] = []
            for i in range(textpage.count_chars()):
                char = textpage.get_text_range(i, 1)
                if not char.strip():
                    continue
                left, bottom, right, top = textpage.get_charbox(i)
                if left < safe[0] - 0.01 or bottom < safe[1] - 0.01 or right > safe[2] + 0.01 or top > safe[3] + 0.01:
                    outside.append(char)
            if outside:
                sample = "".join(outside[:20])
                report.add(
                    "text.safe_zone",
                    Severity.WARNING,
                    f"{len(outside)} caractère(s) hors zone de sécurité ({spec.safe_mm:g} mm du bord fini) : "
                    f"« {sample}{'…' if len(outside) > 20 else ''} ». Risque de coupe.",
                    page=number,
                    count=len(outside),
                )
            textpage.close()
            page.close()
    finally:
        doc.close()


def _check_tac(report: Report, pdf_path, spec: DocumentSpec, output_icc) -> None:
    try:
        values = measure_tac(pdf_path, output_icc=output_icc)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        report.add("ink.not_measured", Severity.INFO, "Couverture d'encre non mesurée (échec du rendu).", error=str(exc))
        return
    if values is None:
        report.add("ink.not_measured", Severity.INFO, "Couverture d'encre non mesurée (Ghostscript absent).")
        return
    limit = spec.policy.max_tac_percent
    for number, tac in enumerate(values, start=1):
        if tac > limit + 0.5:
            report.add(
                "ink.tac",
                Severity.WARNING,
                f"Couverture d'encre de {tac:.0f} % (maximum {limit:.0f} %) : risque de maculage et de séchage lent.",
                page=number,
                tac=round(tac, 1),
            )
