"""Fichiers PDF de test à déposer sur le site (dossier public/exemples).

- jeu-54-carte-blanche.pdf : jeu complet de 54 cartes + dos, conforme ;
- oracle-30-tarot.pdf      : oracle de 30 cartes au format tarot, conforme ;
- jeu-54-a-corriger.pdf    : jeu sans fond perdu, avec une image pixelisée
                             et un texte trop près du bord (refusé).

    python generate_test_files.py <dossier_polices_fontsource> <dossier_sortie>
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).parent))
import generate_visuals as gv  # noqa: E402

MM = 72 / 25.4
BLEED = 3 * MM


def deck_cards() -> list[tuple[Image.Image, tuple[int, int, int]]]:
    """Dos + 54 faces dans l'ordre du gabarit (pique, cœur, carreau, trèfle ; As → Roi ; jokers)."""
    names = {"S": ("Papa", "Maman", "Léo"), "H": ("Papi", "Mamie", "Jules"),
             "D": ("Tonton", "Tata", "Emma"), "C": ("Parrain", "Marraine", "Lou")}
    cards = [(gv.back_card(), gv.FELT)]
    for i, suit in enumerate("SHDC"):
        cards.append((gv.ace_card(suit), gv.PAPER))
        for n in range(2, 11):
            cards.append((gv.number_card(n, suit), gv.PAPER))
        king, queen, jack = names[suit]
        cards.append((gv.court_card("V", suit, "jack", jack, gv.SKIN[i % 4], gv.HAIR[(i + 2) % 5]), gv.PAPER))
        cards.append((gv.court_card("D", suit, "queen", queen, gv.SKIN[(i + 1) % 4], gv.HAIR[(i + 1) % 5], long_hair=True), gv.PAPER))
        cards.append((gv.court_card("R", suit, "king", king, gv.SKIN[i % 4], gv.HAIR[i % 5], beard=True), gv.PAPER))
    cards += [(gv.joker_card(), gv.PAPER), (gv.joker_card(), gv.PAPER)]
    return cards


def oracle_cards(count: int) -> list[tuple[Image.Image, tuple[int, int, int]]]:
    midnight, sand = (28, 36, 64), (232, 214, 176)
    titles = ["La Lune", "Le Soleil", "L'Étoile", "Le Regard", "Le Seuil", "L'Élan", "La Source", "Le Passage",
              "La Clé", "Le Souffle"]
    motifs = ["moon", "sun", "star", "eye"]
    cards = [(gv.oracle_card("", "back", midnight, sand), midnight)]
    for i in range(count):
        dark = i % 3 != 1
        bg, ink = (midnight, sand) if dark else (sand, midnight)
        cards.append((gv.oracle_card(titles[i % len(titles)], motifs[i % len(motifs)], bg, ink), bg))
    return cards


def to_reader(img: Image.Image) -> ImageReader:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    return ImageReader(buf)


def write_pdf(path: Path, cards, trim_mm: tuple[float, float], bleed: bool = True, spoil=None) -> None:
    tw, th = trim_mm[0] * MM, trim_mm[1] * MM
    b = BLEED if bleed else 0
    c = canvas.Canvas(str(path), pagesize=(tw + 2 * b, th + 2 * b))
    c.setTitle(path.stem)
    for index, (img, bg) in enumerate(cards):
        c.setFillColorRGB(*(v / 255 for v in bg))
        c.rect(0, 0, tw + 2 * b, th + 2 * b, stroke=0, fill=1)
        c.drawImage(to_reader(img), b, b, tw, th, mask="auto")
        if spoil:
            spoil(c, index, tw, th, b)
        c.showPage()
    c.save()


def main(font_root: str, out: str) -> None:
    gv.load_fonts(font_root)
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    deck = deck_cards()
    write_pdf(out_dir / "jeu-54-carte-blanche.pdf", deck, (63.5, 88.9))
    write_pdf(out_dir / "oracle-30-tarot.pdf", oracle_cards(30), (70.0, 120.0))

    def spoil(c, index, tw, th, b):
        if index == 12:  # Dame de pique : photo trop petite et texte au bord
            tiny = gv.court_card("D", "S", "queen", "Maman", gv.SKIN[1], gv.HAIR[1], long_hair=True).resize((60, 84))
            c.drawImage(to_reader(tiny), b + 20, b + 40, tw - 40, th - 80)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(b + 2, b + th / 2, "Mariage 2026")

    write_pdf(out_dir / "jeu-54-a-corriger.pdf", deck, (63.5, 88.9), bleed=False, spoil=spoil)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
