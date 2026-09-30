// Étui personnalisé à plat, dessiné dans le navigateur à partir du gabarit calculé par le serveur
// (CB_Box::geometry) : même image pour l'aperçu et pour l'impression (300 dpi, fond perdu compris).
import type { Crop } from "@/lib/design.ts";
import { cropRect, loadImage } from "@/lib/cardrender.ts";
import { format } from "@/lib/format.ts";

type Rect = [number, number, number, number]; // x, y, largeur, hauteur (mm, origine en haut à gauche, hors fond perdu)
export type BoxGeometry = {
  w: number; h: number; d: number; W: number; H: number; bleed: number;
  panels: Record<"glue" | "back" | "left" | "front" | "right" | "top" | "bottom", Rect>;
  cut: [number, number][]; crease: [number, number, number, number][];
};
export type BoxInfo = {
  pack: string; packs: { id: string; label: string; hint: string; price: number }[];
  geometry: BoxGeometry; px: [number, number]; back: string; template: string;
  design: { bg?: string; ink?: string; title?: string; subtitle?: string };
};
/** Face avant : le dos du jeu, une photo, ou une couleur et un titre. */
export type BoxDesign = {
  face: "dos" | "photo" | "couleur"; photo: string | null; crop: Crop;
  bg: string; ink: string; title: string; subtitle: string; message: string;
};

async function fonts() {
  await Promise.all(['40px "CB Display"', '40px "CB Serif"'].map((f) => document.fonts?.load(f).catch(() => null)));
}

/** Texte sur une ligne, réduit jusqu'à tenir dans `max` px. */
function fit(g: CanvasRenderingContext2D, text: string, family: string, size: number, max: number) {
  g.font = `${size}px ${family}`;
  while (g.measureText(text).width > max && size > 4) { size *= 0.94; g.font = `${size}px ${family}`; }
  return size;
}

/** Lignes d'un texte coupé à la largeur `max`. */
function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > max) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Image « couverture » dans un rectangle (px). */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, [x, y, w, h]: Rect, crop: Crop, inset = 0) {
  const iw = img.naturalWidth * (1 - 2 * inset), ih = img.naturalHeight * (1 - 2 * inset);
  const [sx, sy, sw, sh] = cropRect(iw, ih, crop, w / h);
  g.drawImage(img, sx + img.naturalWidth * inset, sy + img.naturalHeight * inset, sw, sh, x, y, w, h);
}

/** Couleur du fond perdu du dos (coin de l'image) : fond de l'étui quand le jeu vient d'un PDF. */
export async function edgeColor(url: string): Promise<string> {
  const img = await loadImage(url), c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d")!;
  g.drawImage(img, 2, 2, 8, 8, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return `#${[r, gg, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Dessine l'étui à plat sur `target` (toute la toile = gabarit + fond perdu). */
export async function drawBox(target: HTMLCanvasElement, info: BoxInfo, d: BoxDesign, guides = false) {
  await fonts();
  const G = info.geometry, b = G.bleed, s = target.width / (G.W + 2 * b);
  const R = (r: Rect): Rect => [(r[0] + b) * s, (r[1] + b) * s, r[2] * s, r[3] * s];
  const g = target.getContext("2d")!;
  g.fillStyle = d.bg; g.fillRect(0, 0, target.width, target.height);
  const back = d.face === "dos" ? await loadImage(info.back) : null;
  const photo = d.face === "photo" && d.photo ? await loadImage(d.photo) : null;
  const bleedFrac = b / format().page[0]; // le dos du jeu comprend son propre fond perdu

  const titled = ([x, y, w, h]: Rect) => {
    g.fillStyle = d.ink; g.textAlign = "center"; g.textBaseline = "middle";
    const size = fit(g, d.title || " ", '"CB Display", sans-serif', w * 0.16, w * 0.84);
    g.fillText(d.title, x + w / 2, y + h / 2 - (d.subtitle ? size * 0.4 : 0));
    if (d.subtitle) {
      fit(g, d.subtitle, '"CB Serif", Georgia, serif', w * 0.07, w * 0.84);
      g.fillText(d.subtitle, x + w / 2, y + h / 2 + size * 0.7);
    }
  };
  const art = (r: Rect) => {
    if (back) cover(g, back, r, { zoom: 1, x: 0.5, y: 0.5 }, bleedFrac);
    else if (photo) cover(g, photo, r, d.crop);
    else titled(r);
  };

  art(R(G.panels.front));
  const bp = R(G.panels.back);
  if (d.message.trim()) {
    const [x, y, w, h] = bp;
    g.fillStyle = d.ink; g.textAlign = "center"; g.textBaseline = "middle";
    let size = w * 0.075;
    g.font = `${size}px "CB Serif", Georgia, serif`;
    let lines = wrap(g, d.message.trim(), w * 0.8);
    while (lines.length * size * 1.35 > h * 0.8 && size > 6) { size *= 0.92; g.font = `${size}px "CB Serif", Georgia, serif`; lines = wrap(g, d.message.trim(), w * 0.8); }
    lines.forEach((l, i) => g.fillText(l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.35));
  } else art(bp);

  // Tranches : le titre, de bas en haut
  for (const side of [G.panels.left, G.panels.right]) {
    const [x, y, w, h] = R(side);
    g.save();
    g.translate(x + w / 2, y + h / 2); g.rotate(-Math.PI / 2);
    g.fillStyle = d.ink; g.textAlign = "center"; g.textBaseline = "middle";
    fit(g, d.title || "Carte Blanche", '"CB Display", sans-serif', w * 0.5, h * 0.8);
    g.fillText(d.title || "Carte Blanche", 0, 0);
    g.restore();
  }

  if (guides) { // aperçu : hors de l'étui voilé, découpe (magenta) et rainage (cyan, pointillés)
    const P = ([x, y]: [number, number]) => [(x + b) * s, (y + b) * s] as const;
    const shape = new Path2D();
    G.cut.forEach((p, i) => (i ? shape.lineTo(...P(p)) : shape.moveTo(...P(p))));
    shape.closePath();
    const veil = new Path2D();
    veil.rect(0, 0, target.width, target.height);
    veil.addPath(shape);
    g.save();
    g.fillStyle = "rgba(247,246,243,.82)"; g.fill(veil, "evenodd");
    g.lineWidth = Math.max(1, s * 0.25);
    g.strokeStyle = "#E4007C"; g.stroke(shape);
    g.strokeStyle = "#00A0E3"; g.setLineDash([s * 1.5, s]); g.beginPath();
    for (const [x1, y1, x2, y2] of G.crease) { g.moveTo(...P([x1, y1])); g.lineTo(...P([x2, y2])); }
    g.stroke();
    g.restore();
  }
}

export async function renderBox(info: BoxInfo, d: BoxDesign): Promise<Blob> {
  const c = document.createElement("canvas");
  [c.width, c.height] = info.px;
  await drawBox(c, info, d);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Rendu de l'étui impossible."))), "image/jpeg", 0.92));
}
