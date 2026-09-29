"""Conversion RVB → CMJN avec le profil de la presse (LittleCMS via Pillow).

Pourquoi pas Ghostscript : sa sortie PDF (version 10.x) ne permet pas de choisir
le profil CMJN de destination. Il convertit aussi le texte noir RVB en noir
quadri, ce qui est inacceptable pour du texte fin.

Ce qui est converti :
- les images RVB (DeviceRGB, CalRGB, ICCBased N=3, indexées RVB) ; le profil
  ICC incorporé dans l'image est respecté, sRGB sinon ;
- les couleurs vectorielles RVB (rg/RG, cs/CS + sc/scn) ;
- les groupes de transparence déclarés en RVB.

Règles de noir : un RVB neutre (R = G = B) devient du noir seul (K), sans
cyan, magenta ni jaune. Ainsi, du texte noir RVB sort en 100 % K.

Ce qui n'est pas converti (laissé en RVB, signalé dans le rapport) : dégradés
(shadings) et images en ligne. Le PDF reste valide en PDF/X-4 et le
contrôleur les convertira avec l'OutputIntent.

Les tons directs (encres spéciales, repères) ne sont jamais touchés.
"""

from __future__ import annotations

import io
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import pikepdf
from pikepdf import Name
from PIL import Image, ImageCms

RELATIVE = ImageCms.Intent.RELATIVE_COLORIMETRIC
PERCEPTUAL = ImageCms.Intent.PERCEPTUAL
BPC = ImageCms.Flags.BLACKPOINTCOMPENSATION


@dataclass
class ConversionReport:
    images_converted: int = 0
    colors_converted: int = 0
    skipped: list[str] = field(default_factory=list)


class CmykConverter:
    def __init__(self, cmyk_icc: str | Path, rgb_icc: str | Path | None = None):
        self.cmyk_profile = ImageCms.getOpenProfile(str(cmyk_icc))
        self.rgb_profile = ImageCms.getOpenProfile(str(rgb_icc)) if rgb_icc else ImageCms.createProfile("sRGB")
        # Vectoriel : colorimétrie relative + compensation du point noir (aplats fidèles).
        self._vector = ImageCms.buildTransform(
            self.rgb_profile, self.cmyk_profile, "RGB", "CMYK", renderingIntent=RELATIVE, flags=BPC
        )
        self._cache: dict[tuple[float, float, float], tuple[float, float, float, float]] = {}

    def color(self, r: float, g: float, b: float) -> tuple[float, float, float, float]:
        key = (round(r, 4), round(g, 4), round(b, 4))
        if key not in self._cache:
            if key[0] == key[1] == key[2]:
                self._cache[key] = (0.0, 0.0, 0.0, round(1.0 - key[0], 4))
            else:
                px = Image.new("RGB", (1, 1), tuple(int(round(v * 255)) for v in key))
                c, m, y, k = ImageCms.applyTransform(px, self._vector).getpixel((0, 0))
                self._cache[key] = tuple(round(v / 255, 4) for v in (c, m, y, k))
        return self._cache[key]

    def image(self, pil: Image.Image, icc_bytes: bytes | None) -> Image.Image:
        """Photos : intention perceptive, profil de l'image si présent."""
        source = self.rgb_profile
        if icc_bytes:
            try:
                source = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
            except (OSError, ImageCms.PyCMSError):
                pass
        return ImageCms.profileToProfile(
            pil.convert("RGB"), source, self.cmyk_profile, renderingIntent=PERCEPTUAL, outputMode="CMYK", flags=BPC
        )


def _is_rgb_space(cs, resources) -> bool:
    if cs is None:
        return False
    if isinstance(cs, Name):
        if cs in (Name.DeviceRGB, Name("/CalRGB")):
            return True
        named = resources.get("/ColorSpace") if resources is not None else None
        if named is not None and cs in named:
            return _is_rgb_space(named[cs], None)
        return False
    if isinstance(cs, pikepdf.Array) and len(cs) > 0:
        family = cs[0]
        if family == Name("/ICCBased"):
            return int(cs[1].get("/N", 0)) == 3
        return family == Name("/CalRGB")
    return False


class _PdfConverter:
    def __init__(self, pdf: pikepdf.Pdf, converter: CmykConverter):
        self.pdf = pdf
        self.cv = converter
        self.report = ConversionReport()
        self.done: set[tuple[int, int]] = set()

    def run(self) -> ConversionReport:
        for page in self.pdf.pages:
            resources = page.obj.get("/Resources")
            if resources is None:
                continue
            self._resources(resources)
            self._rewrite_stream(page, resources, is_page=True)
            self._group(page.obj)
        return self.report

    def _group(self, obj) -> None:
        group = obj.get("/Group")
        if group is not None and _is_rgb_space(group.get("/CS"), None):
            group["/CS"] = Name.DeviceCMYK

    def _resources(self, resources) -> None:
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return
        for key in list(xobjects.keys()):
            xobj = xobjects[key]
            if xobj.objgen in self.done:
                continue
            if xobj.objgen != (0, 0):
                self.done.add(xobj.objgen)
            subtype = xobj.get("/Subtype")
            if subtype == Name.Image:
                self._image(xobj, resources)
            elif subtype == Name.Form:
                form_res = xobj.get("/Resources", resources)
                self._resources(form_res)
                self._rewrite_stream(xobj, form_res, is_page=False)
                self._group(xobj)

    def _image(self, xobj, resources) -> None:
        if xobj.get("/ImageMask", False):
            return
        cs = xobj.get("/ColorSpace")
        indexed_rgb = (
            isinstance(cs, pikepdf.Array) and len(cs) > 1 and cs[0] == Name.Indexed and _is_rgb_space(cs[1], resources)
        )
        if not (_is_rgb_space(cs, resources) or indexed_rgb):
            return
        try:
            pdf_image = pikepdf.PdfImage(xobj)
            pil = pdf_image.as_pil_image()
        except Exception as exc:  # filtre non décodable : laissé au contrôleur
            self.report.skipped.append(f"image non décodable ({exc.__class__.__name__})")
            return
        icc = None
        if isinstance(cs, pikepdf.Array) and cs[0] == Name("/ICCBased"):
            icc = cs[1].read_bytes()
        cmyk = self.cv.image(pil, icc)
        xobj.write(zlib.compress(cmyk.tobytes(), 6), filter=Name.FlateDecode)
        xobj["/ColorSpace"] = Name.DeviceCMYK
        xobj["/BitsPerComponent"] = 8
        for key in ("/Decode", "/DecodeParms"):
            if key in xobj:
                del xobj[key]
        self.report.images_converted += 1

    def _rewrite_stream(self, target, resources, is_page: bool) -> None:
        instructions = pikepdf.parse_content_stream(target.obj if is_page else target)
        out = []
        changed = False
        fill_rgb = stroke_rgb = False
        stack: list[tuple[bool, bool]] = []
        for inst in instructions:
            if isinstance(inst, pikepdf.ContentStreamInlineImage):
                if _inline_is_rgb(inst):
                    self.report.skipped.append("image en ligne RVB")
                out.append(inst)
                continue
            op = str(inst.operator)
            operands = list(inst.operands)
            if op == "q":
                stack.append((fill_rgb, stroke_rgb))
            elif op == "Q" and stack:
                fill_rgb, stroke_rgb = stack.pop()
            elif op in ("rg", "RG") and len(operands) == 3:
                cmyk = self.cv.color(*(float(v) for v in operands))
                inst = pikepdf.ContentStreamInstruction(list(cmyk), pikepdf.Operator("k" if op == "rg" else "K"))
                self.report.colors_converted += 1
                changed = True
            elif op in ("cs", "CS") and operands:
                is_rgb = _is_rgb_space(operands[0], resources)
                if op == "cs":
                    fill_rgb = is_rgb
                else:
                    stroke_rgb = is_rgb
                if is_rgb:
                    inst = pikepdf.ContentStreamInstruction([Name.DeviceCMYK], pikepdf.Operator(op))
                    changed = True
            elif op in ("sc", "scn") and fill_rgb and len(operands) == 3:
                inst = pikepdf.ContentStreamInstruction(list(self.cv.color(*(float(v) for v in operands))),
                                                        pikepdf.Operator(op))
                self.report.colors_converted += 1
                changed = True
            elif op in ("SC", "SCN") and stroke_rgb and len(operands) == 3:
                inst = pikepdf.ContentStreamInstruction(list(self.cv.color(*(float(v) for v in operands))),
                                                        pikepdf.Operator(op))
                self.report.colors_converted += 1
                changed = True
            elif op == "sh":
                shadings = resources.get("/Shading")
                if shadings is not None and operands and operands[0] in shadings:
                    if _is_rgb_space(shadings[operands[0]].get("/ColorSpace"), resources):
                        self.report.skipped.append("dégradé RVB")
            out.append(inst)
        if changed:
            data = pikepdf.unparse_content_stream(out)
            if is_page:
                target.obj["/Contents"] = self.pdf.make_stream(data)
            else:
                target.write(data)


def _inline_is_rgb(inst: pikepdf.ContentStreamInlineImage) -> bool:
    try:
        return str(inst.iimage.colorspace) in ("/DeviceRGB", "/RGB")
    except Exception:
        return False


def convert_pdf_to_cmyk(
    input_pdf: str | Path, output_pdf: str | Path, cmyk_icc: str | Path, rgb_icc: str | Path | None = None
) -> ConversionReport:
    converter = CmykConverter(cmyk_icc, rgb_icc)
    with pikepdf.open(input_pdf) as pdf:
        report = _PdfConverter(pdf, converter).run()
        pdf.save(output_pdf)
    return report
