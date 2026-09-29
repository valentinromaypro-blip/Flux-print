"""Parcours des flux de contenu PDF.

Interprète le strict nécessaire des opérateurs pour savoir, page par page :
- où et à quelle taille chaque image est posée (résolution effective) ;
- quels espaces colorimétriques sont utilisés (RVB, CMJN, tons directs…) ;
- l'épaisseur réelle des filets ;
- l'usage de transparence et de surimpression.

La matrice courante (CTM) est suivie à travers q/Q, cm et les Form XObjects.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import pikepdf
from pikepdf import Name

Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

# Noms de séparations qui correspondent aux encres quadri.
PROCESS_COLORANTS = {"Cyan", "Magenta", "Yellow", "Black"}
MAX_FORM_DEPTH = 12


def mat_mul(m1: Matrix, m2: Matrix) -> Matrix:
    """m1 × m2 (convention PDF : vecteurs lignes)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _as_matrix(values) -> Matrix:
    return tuple(float(v) for v in values)  # type: ignore[return-value]


@dataclass
class ImagePlacement:
    name: str
    width_px: int
    height_px: int
    placed_w_pt: float
    placed_h_pt: float
    colorspace: str
    is_mask: bool

    @property
    def effective_ppi(self) -> float:
        """Résolution la plus faible des deux axes à la taille de pose."""
        if self.placed_w_pt <= 0 or self.placed_h_pt <= 0:
            return math.inf
        return min(
            self.width_px / (self.placed_w_pt / 72.0),
            self.height_px / (self.placed_h_pt / 72.0),
        )


@dataclass
class PageScan:
    images: list[ImagePlacement] = field(default_factory=list)
    colorspaces: set[str] = field(default_factory=set)
    spot_names: set[str] = field(default_factory=set)
    stroke_widths_pt: list[float] = field(default_factory=list)
    uses_transparency: bool = False
    uses_overprint: bool = False
    fonts: dict[str, pikepdf.Object] = field(default_factory=dict)


class ColorspaceClassifier:
    """Ramène n'importe quel espace colorimétrique PDF à une famille simple."""

    INLINE_ABBREVS = {"/RGB": "/DeviceRGB", "/CMYK": "/DeviceCMYK", "/G": "/DeviceGray", "/I": "/Indexed"}

    def __init__(self, scan: PageScan):
        self.scan = scan

    def classify(self, cs, resources, depth: int = 0) -> str:
        if depth > 8 or cs is None:
            return "Unknown"
        if isinstance(cs, Name) or isinstance(cs, str):
            name = self.INLINE_ABBREVS.get(str(cs), str(cs))
            simple = {
                "/DeviceRGB": "RGB",
                "/CalRGB": "RGB",
                "/DeviceCMYK": "CMYK",
                "/DeviceGray": "Gray",
                "/CalGray": "Gray",
                "/Pattern": "Pattern",
                "/Lab": "Lab",
            }
            if name in simple:
                return simple[name]
            named = _get(resources, "/ColorSpace")
            if named is not None and name in named:
                return self.classify(named[name], resources, depth + 1)
            return "Unknown"
        if isinstance(cs, pikepdf.Array) and len(cs) > 0:
            family = str(cs[0])
            if family == "/ICCBased":
                n = int(cs[1].get("/N", 3))
                return {1: "Gray", 3: "RGB", 4: "CMYK"}.get(n, "Unknown")
            if family in ("/Indexed", "/I"):
                return self.classify(cs[1], resources, depth + 1)
            if family == "/Pattern":
                return self.classify(cs[1], resources, depth + 1) if len(cs) > 1 else "Pattern"
            if family == "/Separation":
                return self._colorants([str(cs[1])[1:]])
            if family == "/DeviceN":
                return self._colorants([str(n)[1:] for n in cs[1]])
            if family in ("/CalRGB",):
                return "RGB"
            if family in ("/CalGray",):
                return "Gray"
            if family == "/Lab":
                return "Lab"
            return self.classify(Name(family), resources, depth + 1)
        return "Unknown"

    def _colorants(self, names: list[str]) -> str:
        spots = [n for n in names if n not in PROCESS_COLORANTS and n not in ("All", "None")]
        if not spots:
            return "CMYK"
        self.scan.spot_names.update(spots)
        return "Spot"


def _get(dictionary, key):
    try:
        return dictionary.get(key) if dictionary is not None else None
    except Exception:  # objets corrompus : on ignore la clé
        return None


def inherited(page: pikepdf.Dictionary, key: str):
    """Attributs héritables (Resources, MediaBox, CropBox, Rotate) via /Parent."""
    node = page
    for _ in range(64):
        if node is None:
            return None
        if key in node:
            return node[key]
        node = node.get("/Parent")
    return None


class _Scanner:
    def __init__(self, scan: PageScan):
        self.scan = scan
        self.cs = ColorspaceClassifier(scan)

    def run(self, stream, resources, ctm: Matrix, depth: int, stack: tuple) -> None:
        if depth > MAX_FORM_DEPTH:
            return
        try:
            instructions = pikepdf.parse_content_stream(stream)
        except pikepdf.PdfError:
            return
        gstack: list[tuple[Matrix, float]] = []
        line_width = 1.0
        current_font = None
        for inst in instructions:
            op = str(inst.operator)
            operands = inst.operands
            if op == "q":
                gstack.append((ctm, line_width))
            elif op == "Q":
                if gstack:
                    ctm, line_width = gstack.pop()
            elif op == "cm" and len(operands) == 6:
                ctm = mat_mul(_as_matrix(operands), ctm)
            elif op == "w" and operands:
                line_width = float(operands[0])
            elif op in ("S", "s", "B", "B*", "b", "b*"):
                scale = math.sqrt(abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]))
                self.scan.stroke_widths_pt.append(line_width * scale)
            elif op in ("rg", "RG"):
                self.scan.colorspaces.add("RGB")
            elif op in ("k", "K"):
                self.scan.colorspaces.add("CMYK")
            elif op in ("g", "G"):
                self.scan.colorspaces.add("Gray")
            elif op in ("cs", "CS") and operands:
                self.scan.colorspaces.add(self.cs.classify(operands[0], resources))
            elif op == "gs" and operands:
                self._ext_gstate(resources, operands[0])
            elif op == "sh" and operands:
                shadings = _get(resources, "/Shading")
                if shadings is not None and operands[0] in shadings:
                    sh = shadings[operands[0]]
                    self.scan.colorspaces.add(self.cs.classify(sh.get("/ColorSpace"), resources))
            elif op == "Tf" and operands:
                current_font = operands[0]
            elif op in ("Tj", "TJ", "'", '"') and current_font is not None:
                self._use_font(resources, current_font)
            elif op == "Do" and operands:
                self._xobject(resources, operands[0], ctm, depth, stack)
            elif op == "INLINE IMAGE" and operands:
                self._inline_image(operands[0], ctm, resources)

    def _ext_gstate(self, resources, name) -> None:
        states = _get(resources, "/ExtGState")
        if states is None or name not in states:
            return
        gs = states[name]
        for key in ("/ca", "/CA"):
            if key in gs and float(gs[key]) < 1.0:
                self.scan.uses_transparency = True
        if str(gs.get("/BM", "/Normal")) not in ("/Normal", "/Compatible"):
            self.scan.uses_transparency = True
        smask = gs.get("/SMask")
        if smask is not None and str(smask) != "/None":
            self.scan.uses_transparency = True
        if bool(gs.get("/OP", False)) or bool(gs.get("/op", False)):
            self.scan.uses_overprint = True

    def _xobject(self, resources, name, ctm: Matrix, depth: int, stack: tuple) -> None:
        xobjects = _get(resources, "/XObject")
        if xobjects is None or name not in xobjects:
            return
        xobj = xobjects[name]
        subtype = str(xobj.get("/Subtype", ""))
        if subtype == "/Image":
            is_mask = bool(xobj.get("/ImageMask", False))
            if "/SMask" in xobj or "/Mask" in xobj:
                self.scan.uses_transparency = True
            cs = "Mask" if is_mask else self.cs.classify(xobj.get("/ColorSpace"), resources)
            if not is_mask:
                self.scan.colorspaces.add(cs)
            self.scan.images.append(
                ImagePlacement(
                    name=str(name),
                    width_px=int(xobj.get("/Width", 0)),
                    height_px=int(xobj.get("/Height", 0)),
                    placed_w_pt=math.hypot(ctm[0], ctm[1]),
                    placed_h_pt=math.hypot(ctm[2], ctm[3]),
                    colorspace=cs,
                    is_mask=is_mask,
                )
            )
        elif subtype == "/Form":
            key = xobj.objgen
            if key != (0, 0) and key in stack:
                return  # boucle de références
            form_matrix = _as_matrix(xobj.get("/Matrix", IDENTITY))
            form_resources = xobj.get("/Resources", resources)
            if "/Group" in xobj and str(xobj["/Group"].get("/S", "")) == "/Transparency":
                self.scan.uses_transparency = True
            self.run(xobj, form_resources, mat_mul(form_matrix, ctm), depth + 1, stack + (key,))

    def _inline_image(self, image: pikepdf.PdfInlineImage, ctm: Matrix, resources) -> None:
        is_mask = bool(image.image_mask)
        if is_mask:
            cs = "Mask"
        else:
            raw = image._colorspaces[0] if image._colorspaces else None
            cs = self.cs.classify(raw, resources) if raw is not None else "Unknown"
            self.scan.colorspaces.add(cs)
        self.scan.images.append(
            ImagePlacement(
                name="(inline)",
                width_px=int(image.width),
                height_px=int(image.height),
                placed_w_pt=math.hypot(ctm[0], ctm[1]),
                placed_h_pt=math.hypot(ctm[2], ctm[3]),
                colorspace=cs,
                is_mask=is_mask,
            )
        )

    def _use_font(self, resources, name) -> None:
        """Seules les polices qui affichent réellement du texte comptent."""
        fonts = _get(resources, "/Font")
        if fonts is None or name not in fonts:
            return
        font = fonts[name]
        ident = font.objgen if font.objgen != (0, 0) else (str(name), id(font))
        self.scan.fonts[str(ident)] = font


def scan_page(page: pikepdf.Page) -> PageScan:
    scan = PageScan()
    resources = inherited(page.obj, "/Resources")
    _Scanner(scan).run(page.obj, resources, IDENTITY, 0, ())
    if "/Group" in page.obj and str(page.obj["/Group"].get("/S", "")) == "/Transparency":
        scan.uses_transparency = True
    scan.colorspaces.discard("Unknown")
    return scan


def font_is_embedded(font: pikepdf.Object) -> bool:
    subtype = str(font.get("/Subtype", ""))
    if subtype == "/Type3":
        return True  # glyphes décrits dans le PDF
    if subtype == "/Type0":
        descendants = font.get("/DescendantFonts")
        if not descendants:
            return False
        font = descendants[0]
    descriptor = font.get("/FontDescriptor")
    if descriptor is None:
        return False
    return any(k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3"))


def font_name(font: pikepdf.Object) -> str:
    return str(font.get("/BaseFont", "(sans nom)")).lstrip("/")
