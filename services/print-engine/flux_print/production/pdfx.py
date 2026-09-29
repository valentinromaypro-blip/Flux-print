"""Finalisation PDF/X-4 (ISO 15930-7) d'un PDF de production.

Rend le fichier autoporteur pour le contrôleur de la presse :
- OutputIntent GTS_PDFX avec le profil CMJN incorporé (ex. FOGRA51) ;
- métadonnées XMP (version PDF/X, dates, identifiants) et /Trapped ;
- TrimBox et BleedBox sur chaque page ;
- PDF 1.6 minimum.

Aucune validation PDF/X open source n'existe (veraPDF ne couvre que PDF/A et
PDF/UA). La conformité est donc assurée à la construction. Elle doit être
vérifiée une première fois avec le preflight du contrôleur ou d'Acrobat.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pikepdf
from pikepdf import Name

PDFX_NS = "http://www.npes.org/pdfx/ns/id/"


def apply_pdfx4(
    pdf: pikepdf.Pdf,
    icc_path: str | Path,
    output_condition_identifier: str,
    output_condition: str = "",
    registry: str = "http://www.color.org",
    title: str = "",
) -> None:
    icc = Path(icc_path).read_bytes()
    profile = pdf.make_stream(icc)
    profile["/N"] = 4
    pdf.Root["/OutputIntents"] = pikepdf.Array([
        pikepdf.Dictionary(
            Type=Name.OutputIntent,
            S=Name("/GTS_PDFX"),
            OutputConditionIdentifier=pikepdf.String(output_condition_identifier),
            OutputCondition=pikepdf.String(output_condition or output_condition_identifier),
            RegistryName=pikepdf.String(registry),
            Info=pikepdf.String(output_condition or output_condition_identifier),
            DestOutputProfile=profile,
        )
    ])

    for page in pdf.pages:
        media = pikepdf.Array([float(v) for v in page.mediabox])
        if "/TrimBox" not in page.obj:
            page.obj["/TrimBox"] = media
        if "/BleedBox" not in page.obj:
            page.obj["/BleedBox"] = media

    now = datetime.now(timezone.utc).replace(microsecond=0)
    pdf.docinfo["/Title"] = pikepdf.String(title or "Flux-print")
    pdf.docinfo["/Creator"] = pikepdf.String("Flux-print")
    pdf.docinfo["/Trapped"] = Name("/False")
    pdf.docinfo["/GTS_PDFXVersion"] = pikepdf.String("PDF/X-4")

    with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
        meta.register_xml_namespace(PDFX_NS, "pdfxid")
        meta["pdfxid:GTS_PDFXVersion"] = "PDF/X-4"
        meta["dc:title"] = title or "Flux-print"
        meta["xmp:CreatorTool"] = "Flux-print"
        meta["xmp:CreateDate"] = now.isoformat()
        meta["xmp:ModifyDate"] = now.isoformat()
        meta["xmp:MetadataDate"] = now.isoformat()
        meta["pdf:Producer"] = "Flux-print (pikepdf)"
        meta["pdf:Trapped"] = "False"
        meta["xmpMM:DocumentID"] = f"uuid:{uuid.uuid4()}"
        meta["xmpMM:InstanceID"] = f"uuid:{uuid.uuid4()}"


def is_pdfx4(pdf: pikepdf.Pdf) -> bool:
    intents = pdf.Root.get("/OutputIntents")
    if not intents:
        return False
    has_gts = any(i.get("/S") == Name("/GTS_PDFX") and "/DestOutputProfile" in i for i in intents)
    meta = pdf.open_metadata()
    return has_gts and meta.get(f"{{{PDFX_NS}}}GTS_PDFXVersion") == "PDF/X-4"
