// Conditionnement : maquettes réalistes pour le choix du client (jeu sous film, étui à fenêtre
// Carte Blanche, étui personnalisé) et étui personnalisé à plat pour l'impression, dessiné avec les
// mêmes faces à partir du gabarit exact calculé par le serveur (CB_Box::geometry).
import type { Crop } from "@/lib/design.ts";
import { cropRect, loadImage } from "@/lib/cardrender.ts";
import { CB } from "@/lib/env.ts";
import { format } from "@/lib/format.ts";

export type Pack = "film" | "fenetre" | "custom";
type Rect = [number, number, number, number]; // x, y, largeur, hauteur
export type BoxGeometry = {
  w: number; h: number; d: number; W: number; H: number; bleed: number;
  panels: Record<"glue" | "back" | "left" | "front" | "right" | "top" | "bottom", Rect>;
  cut: [number, number][]; crease: [number, number, number, number][];
};
export type BoxInfo = { pack: string; geometry: BoxGeometry; px: [number, number]; back: string };
/** Étui personnalisé. Face avant : le dos du jeu, une photo, ou une couleur et un titre. */
export type BoxDesign = {
  face: "dos" | "photo" | "couleur"; photo: string | null; crop: Crop;
  bg: string; ink: string; title: string; subtitle: string; message: string;
};

/** Étui à fenêtre de stock : mêmes valeurs que CB_Box::STOCK et CB_Box::WINDOW. */
const STOCK = { bg: "#134536", ink: "#F0E8D6" };
const WINDOW = { cx: 0.5, cy: 0.57, rx: 0.34, ry: 0.29 };
const CENTER: Crop = { zoom: 1, x: 0.5, y: 0.5 };

async function fonts() {
  await Promise.all(['40px "CB Display"', '40px "CB Serif"', '40px "CB Sans"'].map((f) => document.fonts?.load(f).catch(() => null)));
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
}

/** Texte centré sur une ligne, réduit jusqu'à tenir dans `max` px. */
function line(g: CanvasRenderingContext2D, text: string, family: string, size: number, max: number, x: number, y: number) {
  g.font = `${size}px ${family}`;
  while (g.measureText(text).width > max && size > 3) { size *= 0.94; g.font = `${size}px ${family}`; }
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, x, y);
  return size;
}
function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && g.measureText(next).width > max) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}
/** Image « couverture » dans un rectangle ; `inset` : part rognée de chaque bord (fond perdu du dos). */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, [x, y, w, h]: Rect, crop: Crop, inset: [number, number] = [0, 0]) {
  const iw = img.naturalWidth * (1 - 2 * inset[0]), ih = img.naturalHeight * (1 - 2 * inset[1]);
  const [sx, sy, sw, sh] = cropRect(iw, ih, crop, w / h);
  g.drawImage(img, sx + img.naturalWidth * inset[0], sy + img.naturalHeight * inset[1], sw, sh, x, y, w, h);
}
/** Le dos du jeu comprend son fond perdu : part à rogner de chaque côté. */
const backInset = (): [number, number] => [CB.bleedMm / format().page[0], CB.bleedMm / format().page[1]];

/** Dos d'exemple quand le jeu vient d'un PDF pas encore envoyé. */
export function placeholderBack(): string {
  const [pw, ph] = format().page, c = canvas(pw * 6, ph * 6), g = c.getContext("2d")!;
  g.fillStyle = "#2B2B33"; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = 2;
  for (let i = -c.height; i < c.width; i += 18) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + c.height, c.height); g.stroke(); }
  g.fillStyle = "#fff";
  line(g, "Votre dos", '"CB Display", sans-serif', c.width * 0.13, c.width * 0.7, c.width / 2, c.height / 2);
  return c.toDataURL("image/png");
}

/** Couleur du fond perdu du dos (coin de l'image) : fond de l'étui par défaut quand le jeu vient d'un PDF. */
export async function edgeColor(url: string): Promise<string> {
  const img = await loadImage(url), c = canvas(1, 1), g = c.getContext("2d")!;
  g.drawImage(img, 2, 2, 8, 8, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return `#${[r, gg, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// --- Faces de l'étui personnalisé (px, n'importe quelle échelle) ------------------------------------

type Images = { back: HTMLImageElement | null; photo: HTMLImageElement | null };
async function images(d: BoxDesign, back: string): Promise<Images> {
  await fonts();
  return {
    back: d.face === "dos" || !d.message.trim() ? await loadImage(back).catch(() => null) : null,
    photo: d.face === "photo" && d.photo ? await loadImage(d.photo) : null,
  };
}

function frontArt(g: CanvasRenderingContext2D, r: Rect, d: BoxDesign, im: Images) {
  const [x, y, w, h] = r;
  g.fillStyle = d.bg; g.fillRect(x, y, w, h);
  if (d.face === "dos" && im.back) return cover(g, im.back, r, CENTER, backInset());
  if (d.face === "photo" && im.photo) return cover(g, im.photo, r, d.crop);
  g.fillStyle = d.ink;
  const size = line(g, d.title || " ", '"CB Display", sans-serif', w * 0.15, w * 0.84, x + w / 2, y + h / 2 - (d.subtitle ? w * 0.05 : 0));
  if (d.subtitle) line(g, d.subtitle, '"CB Serif", Georgia, serif', w * 0.065, w * 0.84, x + w / 2, y + h / 2 + size * 0.75);
}
function backArt(g: CanvasRenderingContext2D, r: Rect, d: BoxDesign, im: Images) {
  const msg = d.message.trim();
  if (!msg) return frontArt(g, r, d, im);
  const [x, y, w, h] = r;
  g.fillStyle = d.bg; g.fillRect(x, y, w, h);
  g.fillStyle = d.ink; g.textAlign = "center"; g.textBaseline = "middle";
  let size = w * 0.075;
  g.font = `${size}px "CB Serif", Georgia, serif`;
  let lines = wrap(g, msg, w * 0.8);
  while (lines.length * size * 1.35 > h * 0.8 && size > 4) { size *= 0.92; g.font = `${size}px "CB Serif", Georgia, serif`; lines = wrap(g, msg, w * 0.8); }
  lines.forEach((l, i) => g.fillText(l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.35));
}
/** Tranche : le titre, de bas en haut. */
function spine(g: CanvasRenderingContext2D, [x, y, w, h]: Rect, bg: string, ink: string, title: string) {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(-Math.PI / 2);
  g.fillStyle = ink; line(g, title || "Carte Blanche", '"CB Display", sans-serif', w * 0.46, h * 0.8, 0, 0);
  g.restore();
}

// --- Aperçus à plat (en attendant les photos de mockup réglées dans l'atelier) -------------------------

type Face = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Une face w × h (mm) centrée, coins légèrement arrondis, ombre douce ; `gloss` : reflet d'un film. */
function flat(target: HTMLCanvasElement, [w, h]: [number, number], face: Face, radius: number, gloss = false) {
  const g = target.getContext("2d")!, W = target.width, H = target.height, pad = W * 0.12;
  const s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h), fw = w * s, fh = h * s;
  const x = (W - fw) / 2, y = (H - fh) / 2, r = radius * s;
  const c = canvas(fw, fh);
  face(c.getContext("2d")!, c.width, c.height);
  g.clearRect(0, 0, W, H);
  g.save();
  g.shadowColor = "rgba(0,0,0,.22)"; g.shadowBlur = W / 30; g.shadowOffsetY = W / 90;
  g.beginPath(); g.roundRect(x, y, fw, fh, r); g.fillStyle = "#fff"; g.fill();
  g.restore();
  g.save(); g.beginPath(); g.roundRect(x, y, fw, fh, r); g.clip();
  g.drawImage(c, x, y, fw, fh);
  if (gloss) {
    const shine = g.createLinearGradient(x, y, x + fw, y + fh);
    shine.addColorStop(0, "rgba(255,255,255,0)"); shine.addColorStop(0.3, "rgba(255,255,255,.22)"); shine.addColorStop(0.42, "rgba(255,255,255,0)");
    g.fillStyle = shine; g.fillRect(x, y, fw, fh);
  }
  g.restore();
}

/** Dimensions de l'étui (mm) estimées pour l'aperçu ; le serveur calcule les cotes exactes. */
export function boxSize(cards: number, media: string, deck = false): [number, number, number] {
  const [tw, th] = format().trim, t = cards * (CB.spec.caliper[media] ?? 0.4);
  return deck ? [tw, th, t] : [tw + 1.5, th + 1.5, t + 1.5];
}

/** Maquette du conditionnement choisi. `back` : image du dos du jeu (fond perdu compris). */
/** `turned` : l'étui vu de dos (message, mentions). */
export async function drawMockup(target: HTMLCanvasElement, pack: Pack, back: string, cards: number, media: string, design?: BoxDesign, turned = false) {
  await fonts();
  if (pack === "custom" && design) {
    const im = await images(design, back);
    const [w, h] = boxSize(cards, media);
    return flat(target, [w, h], (g, fw, fh) => (turned ? backArt : frontArt)(g, [0, 0, fw, fh], design, im), 0.8);
  }
  const img = await loadImage(back).catch(() => null);
  if (pack === "fenetre") {
    const [bw, bh] = boxSize(cards, media);
    return flat(target, [bw, bh],
      (g, w, h) => {
        g.fillStyle = STOCK.bg; g.fillRect(0, 0, w, h);
        if (turned) { // dos de l'étui de stock (comme CB_Box::stock_pdf)
          g.fillStyle = STOCK.ink;
          line(g, "Carte Blanche", '"CB Display", sans-serif', w * 0.13, w * 0.8, w / 2, h * 0.42);
          line(g, "Imprimé à la demande", '"CB Serif", Georgia, serif', w * 0.065, w * 0.8, w / 2, h * 0.52);
          line(g, location.hostname, '"CB Sans", sans-serif', w * 0.05, w * 0.85, w / 2, h * 0.9);
          return;
        }
        const cx = w * WINDOW.cx, cy = h * WINDOW.cy, rx = w * WINDOW.rx, ry = h * WINDOW.ry;
        g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
        if (img) cover(g, img, [cx - w * 0.5, cy - h * 0.5, w, h], CENTER, backInset()); // le dos, à la même échelle que l'étui
        const inner = g.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.7, cx, cy, Math.max(rx, ry));
        inner.addColorStop(0, "rgba(0,0,0,0)"); inner.addColorStop(1, "rgba(0,0,0,.35)");
        g.fillStyle = inner; g.fillRect(0, 0, w, h); g.restore();
        g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = Math.max(1, w / 160);
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
        g.fillStyle = STOCK.ink;
        line(g, "Carte Blanche", '"CB Display", sans-serif', w * 0.13, w * 0.8, w / 2, h * 0.14);
        line(g, "jeu de cartes personnalisé", '"CB Serif", Georgia, serif', w * 0.06, w * 0.8, w / 2, h * 0.93);
      }, 0.8);
  }
  // Jeu sous film : le dos de la carte du dessus, sous un reflet
  const [w, h] = boxSize(cards, media, true);
  flat(target, [w, h], (g, fw, fh) => {
    if (img) cover(g, img, [0, 0, fw, fh], CENTER, backInset()); else { g.fillStyle = "#ddd"; g.fillRect(0, 0, fw, fh); }
  }, 3.2, true);
}

// --- Étui personnalisé à plat, pour l'impression --------------------------------------------------

/** Étui à plat sur `target` (toute la toile = gabarit + fond perdu) ; `guides` : découpe et plis (contrôle). */
export async function drawFlat(target: HTMLCanvasElement, info: BoxInfo, d: BoxDesign, guides = false) {
  const im = await images(d, info.back);
  const G = info.geometry, b = G.bleed, s = target.width / (G.W + 2 * b);
  const R = (r: Rect): Rect => [(r[0] + b) * s, (r[1] + b) * s, r[2] * s, r[3] * s];
  const g = target.getContext("2d")!;
  g.fillStyle = d.bg; g.fillRect(0, 0, target.width, target.height);
  frontArt(g, R(G.panels.front), d, im);
  backArt(g, R(G.panels.back), d, im);
  spine(g, R(G.panels.left), d.bg, d.ink, d.title);
  spine(g, R(G.panels.right), d.bg, d.ink, d.title);
  if (!guides) return;
  const P = ([x, y]: [number, number]) => [(x + b) * s, (y + b) * s] as const;
  const shape = new Path2D();
  G.cut.forEach((p, i) => (i ? shape.lineTo(...P(p)) : shape.moveTo(...P(p))));
  shape.closePath();
  g.save();
  g.lineWidth = Math.max(1, s * 0.25);
  g.strokeStyle = "#E4007C"; g.stroke(shape);
  g.strokeStyle = "#00A0E3"; g.setLineDash([s * 1.5, s]); g.beginPath();
  for (const [x1, y1, x2, y2] of G.crease) { g.moveTo(...P([x1, y1])); g.lineTo(...P([x2, y2])); }
  g.stroke(); g.restore();
}

export async function renderFlat(info: BoxInfo, d: BoxDesign): Promise<Blob> {
  const c = canvas(...info.px);
  await drawFlat(c, info, d);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Rendu de l'étui impossible."))), "image/jpeg", 0.92));
}
