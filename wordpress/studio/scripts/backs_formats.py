"""Modèles de dos pour les autres formats de cartes (bridge, tarot), dérivés des modèles poker.

Les modèles poker (apps/site/public/cartes/dos, 69,5 × 94,9 mm fond perdu compris) sont repris
élément par élément : les cadres et fonds suivent les bords de la carte, le médaillon, les textes
et le logo restent centrés. Transformer vers le même format redonne le fichier d'origine (vérifié).
Usage : python3 scripts/backs_formats.py
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "../../apps/site/public/cartes/dos"
OUT = HERE / "../carte-blanche/assets/backs"
W0, H0 = 69.5, 94.9
EDGE = 12.0  # un élément à moins de 12 mm d'un bord suit ce bord
FORMATS = {"bridge": (63.2, 94.9), "tarot": (76.0, 126.0)}


def fmt(v: float, original: str) -> str:
    if abs(float(original) - v) < 1e-9:
        return original
    return f"{v:.2f}".rstrip("0").rstrip(".")


def shift(v: float, size0: float, size: float) -> float:
    """Décalage d'une coordonnée : bord gauche/haut fixe, bord droit/bas suit, centre au milieu."""
    if v <= EDGE:
        return 0.0
    if v >= size0 - EDGE:
        return size - size0
    return (size - size0) / 2


def transform(svg: str, W: float, H: float) -> str:
    dW, dH = W - W0, H - H0
    head, rest = svg.split(">", 1)
    head = head.replace(f'viewBox="0 0 {W0} {H0}"', f"viewBox=\"0 0 {fmt(W, '0')} {fmt(H, '0')}\"")
    head = head.replace(f'width="{W0}mm" height="{H0}mm"', f"width=\"{fmt(W, '0')}mm\" height=\"{fmt(H, '0')}mm\"")

    def attr(tag: str, name: str):
        m = re.search(rf'\s{name}="([-0-9.]+)"', tag)
        return (float(m.group(1)), m.group(1)) if m else (None, None)

    def setattr_(tag: str, name: str, v: float) -> str:
        return re.sub(rf'(\s{name}=")([-0-9.]+)(")', lambda m: m.group(1) + fmt(v, m.group(2)) + m.group(3), tag, count=1)

    def element(m: re.Match) -> str:
        tag = m.group(0)
        name = m.group(1)
        if name in ("rect", "image"):
            x, _ = attr(tag, "x")
            y, _ = attr(tag, "y")
            w, _ = attr(tag, "width")
            h, _ = attr(tag, "height")
            x = 0.0 if x is None else x
            y = 0.0 if y is None else y
            if w is not None:
                if x <= EDGE:  # cadre ou fond : garde sa marge, s'étire avec la carte
                    tag = setattr_(tag, "width", w + dW)
                else:
                    tag = setattr_(tag, "x", x + dW / 2) if ' x="' in tag else tag
            if h is not None:
                if y <= EDGE:
                    tag = setattr_(tag, "height", h + dH)
                else:
                    tag = setattr_(tag, "y", y + dH / 2) if ' y="' in tag else tag
            return tag
        if name == "circle":
            cx, _ = attr(tag, "cx")
            cy, _ = attr(tag, "cy")
            tag = setattr_(tag, "cx", cx + shift(cx, W0, W))
            return setattr_(tag, "cy", cy + shift(cy, H0, H))
        if name == "text":
            x, _ = attr(tag, "x")
            y, _ = attr(tag, "y")
            tag = setattr_(tag, "x", x + shift(x, W0, W))
            return setattr_(tag, "y", y + shift(y, H0, H))
        if name == "line":  # le trait suit son point de départ (les rayons gardent leur angle)
            x1, _ = attr(tag, "x1")
            y1, _ = attr(tag, "y1")
            sx, sy = shift(x1, W0, W), shift(y1, H0, H)
            for a in ("x1", "x2"):
                v, _ = attr(tag, a)
                tag = setattr_(tag, a, v + sx)
            for a in ("y1", "y2"):
                v, _ = attr(tag, a)
                tag = setattr_(tag, a, v + sy)
            return tag
        if name == "path":
            d = re.search(r'\sd="([^"]+)"', tag).group(1)
            nums = [float(n) for n in re.findall(r"[-0-9.]+", d)]
            sx, sy = shift(nums[0], W0, W), shift(nums[1], H0, H)
            it = iter(range(len(nums)))
            out, k = [], 0

            def repl(mm):
                nonlocal k
                v = float(mm.group(0))
                v2 = v + (sx if k % 2 == 0 else sy)
                k += 1
                return fmt(v2, mm.group(0))
            return tag.replace(d, re.sub(r"[-0-9.]+", repl, d))
        return tag

    # Les motifs (<pattern>) et filtres gardent leurs coordonnées internes
    parts = re.split(r"(<pattern\b.*?</pattern>|<filter\b.*?</filter>|<clipPath\b|</clipPath>)", rest, flags=re.S)
    out = []
    for part in parts:
        if part.startswith("<pattern") or part.startswith("<filter"):
            # seule l'origine du motif suit le bord
            out.append(part)
        else:
            out.append(re.sub(r"<(rect|image|circle|text|line|path)\b[^>]*>", element, part))
    return head + ">" + "".join(out)


def main() -> None:
    ok = True
    for src in sorted(SRC.glob("*.svg")):
        svg = src.read_text()
        if transform(svg, W0, H0) != svg:
            print(f"écart sur {src.name} au format poker", file=sys.stderr)
            ok = False
        for name, (W, H) in FORMATS.items():
            (OUT / name).mkdir(parents=True, exist_ok=True)
            (OUT / name / src.name).write_text(transform(svg, W, H))
    if not ok:
        sys.exit(1)
    print("modèles de dos : poker identique, bridge et tarot générés")


if __name__ == "__main__":
    main()
