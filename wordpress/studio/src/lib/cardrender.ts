// Dessin des cartes dans le navigateur, calqué sur le moteur (flux_print/design/cardart.py pour le dos,
// flux_print/design/classic.py pour les figures) : l'aperçu montre ce qui sera imprimé.
import type { Crop } from "@/lib/design.ts";
import { asset } from "@/lib/env.ts";

export type Style = "couleur" | "gravure" | "nb" | "sepia";
export type Face = { url: string; cut: boolean };
type Slot = [number, number, number, number, number]; // centre x, centre y, demi-largeur, demi-hauteur, bord haut (unités 240 × 336)

export const RATIO = 336 / 240;
export const HEAD_ROOM = 1.6;
const LINE_DARK = "#22227A";

const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => { images.delete(url); reject(new Error(url)); }; i.src = url;
    }));
  }
  return images.get(url)!;
}

let slotsPromise: Promise<Record<string, Slot>> | null = null;
export const faceSlots = () => (slotsPromise ??= fetch(asset("cards/faces.json")).then((r) => r.json()));

/** Zone de la tête d'origine sur une carte de `width` px (pour le glisser-déplacer de l'aperçu). */
export async function headBox(code: string, width: number) {
  const [cx, cy, rx, ry] = (await faceSlots())[code.replace("-", "")];
  const k = width / 240;
  return { x: (cx - rx) * k, y: (cy - ry) * k, w: 2 * rx * k, h: 2 * ry * k };
}

/** Recadrage « couverture » d'une photo ordinaire (cardart.crop_photo). */
export function cropRect(w: number, h: number, crop: Crop, ratio: number) {
  const cw = Math.min(w, h * ratio) / Math.max(1, crop.zoom), ch = cw / ratio;
  const cx = Math.min(Math.max(crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(crop.y * h, ch / 2), h - ch / 2);
  return [cx - cw / 2, cy - ch / 2, cw, ch] as const;
}

type Stops = [number, number[]][];
const RAMPS: Partial<Record<Style, Stops>> = {
  // Gravure : dégradé bleu nuit → bleu du trait → blanc (classic.stylise)
  gravure: [[10, [18, 18, 96]], [110, [88, 88, 240]], [235, [255, 255, 255]]],
  nb: [[12, [16, 16, 18]], [128, [128, 128, 128]], [245, [255, 255, 255]]],
  sepia: [[12, [38, 24, 14]], [120, [140, 96, 58]], [240, [250, 240, 218]]],
};

/** Niveaux de gris étirés (sur les pixels visibles), puis dégradé de couleurs. */
function ramp(c: CanvasRenderingContext2D, w: number, h: number, stops: Stops) {
  const im = c.getImageData(0, 0, w, h), d = im.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g;
    if (d[i + 3] > 128) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
  }
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - lo) * 255) / Math.max(1, hi - lo);
    let j = 0;
    while (j < stops.length - 2 && g >= stops[j + 1][0]) j++;
    const [[a, ca], [b, cb]] = [stops[j], stops[j + 1]];
    const t = Math.min(1, Math.max(0, (g - a) / (b - a)));
    for (let k = 0; k < 3; k++) d[i + k] = ca[k] + (cb[k] - ca[k]) * t;
  }
  c.putImageData(im, 0, 0);
}

/** Rendu des visages. */
export function applyStyle(c: CanvasRenderingContext2D, w: number, h: number, style: Style) {
  if (RAMPS[style]) ramp(c, w, h, RAMPS[style]!);
}

/**
 * Vintage : encres passées sur papier crème. Même matrice ici et à l'atelier (CB_Production::vintage)
 * pour que les cartes standard du jeu ressemblent aux figures dessinées dans le navigateur.
 */
export const VINTAGE = { sat: 0.45, paper: [243, 232, 208] };
export function vintage(c: CanvasRenderingContext2D, w: number, h: number) {
  const im = c.getImageData(0, 0, w, h), d = im.data, s = VINTAGE.sat, [pr, pg, pb] = VINTAGE.paper.map((v) => v / 255);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = (l + s * (d[i] - l)) * pr; d[i + 1] = (l + s * (d[i + 1] - l)) * pg; d[i + 2] = (l + s * (d[i + 2] - l)) * pb;
  }
  c.putImageData(im, 0, 0);
}

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
}

/**
 * Visage prêt à poser : photo détourée (avec la marge des cheveux, HEAD_ROOM) ou médaillon ovale,
 * au rendu choisi, et son liseré. iw × ih : l'emplacement de la tête ; k : pixels par unité.
 */
export function faceLayer(img: HTMLImageElement, cut: boolean, crop: Crop, iw: number, ih: number, k: number, style: Style, line = LINE_DARK) {
  const stroke = Math.max(1, 1.1 * k), room = cut ? HEAD_ROOM : 1;
  const f = canvas(iw * room, ih * room), g = f.getContext("2d", { willReadFrequently: true })!;
  if (cut) {
    const s = Math.min(iw / img.naturalWidth, ih / img.naturalHeight) * crop.zoom;
    const nw = img.naturalWidth * s, nh = img.naturalHeight * s;
    g.drawImage(img, (f.width - nw) / 2 + (crop.x - 0.5) * iw, (f.height - nh) / 2 + (crop.y - 0.5) * ih, nw, nh);
  } else {
    g.drawImage(img, ...cropRect(img.naturalWidth, img.naturalHeight, crop, iw / ih), 0, 0, f.width, f.height);
    g.globalCompositeOperation = "destination-in";
    g.beginPath(); g.ellipse(f.width / 2, f.height / 2, f.width / 2 - 1.6 * k, f.height / 2 - 1.6 * k, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  }
  applyStyle(g, f.width, f.height, style);
  const ring = canvas(f.width, f.height), r = ring.getContext("2d")!;
  for (let a = 0; a < 16; a++) r.drawImage(f, Math.cos((a * Math.PI) / 8) * stroke, Math.sin((a * Math.PI) / 8) * stroke);
  r.globalCompositeOperation = "source-in"; r.fillStyle = line; r.fillRect(0, 0, ring.width, ring.height);
  return { face: f, ring };
}

export async function drawCourt(target: HTMLCanvasElement, code: string, face: Face | null, crop: Crop, style: Style) {
  const W = target.width, H = target.height, k = W / 240;
  const art = code.replace("-", "");
  const [card, slots] = await Promise.all([loadImage(asset(`cards/${art}.svg`)), faceSlots()]);
  const img = face ? await loadImage(face.url) : null;
  const c = target.getContext("2d")!;
  c.clearRect(0, 0, W, H);
  c.drawImage(card, 0, 0, W, H);
  if (!img) return;
  const [cx, cy, rx, ry, top] = slots[art];
  const { face: f, ring } = faceLayer(img, face!.cut, crop, 2 * rx * k, 2 * ry * k, k, style);
  const x = cx * k - f.width / 2, y = cy * k - f.height / 2;
  for (const flip of [false, true]) {
    c.save();
    if (flip) { c.translate(W, H); c.rotate(Math.PI); }
    c.beginPath(); c.rect(0, top * k, W, H); c.clip();
    c.drawImage(ring, x, y); c.drawImage(f, x, y);
    c.restore();
  }
}
