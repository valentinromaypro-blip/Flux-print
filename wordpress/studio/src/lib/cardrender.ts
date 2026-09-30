// Dessin des cartes dans le navigateur, calqué sur le moteur (flux_print/design/cardart.py pour le dos,
// flux_print/design/classic.py pour les figures) : l'aperçu montre ce qui sera imprimé.
import type { Crop } from "@/lib/design.ts";
import { asset } from "@/lib/env.ts";

export type Style = "couleur" | "gravure" | "nb" | "sepia" | "pop";
/** url : photo détourée si `cut`, sinon la photo ; src : la photo d'origine (modèle portrait). */
export type Face = { url: string; cut: boolean; src?: string };
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

/** Flou « boîte » séparable, en place, sur une couche de w × h valeurs. */
function boxBlur(v: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(v.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += v[y * w + Math.min(w - 1, Math.max(0, x + d))];
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x];
    v[y * w + x] = s / n;
  }
}

/**
 * Pop / BD : couleurs lissées puis ramenées à quatre valeurs franches (ombrage en aplats), trame
 * de points dans les tons clairs et contours encrés. Tailles proportionnelles au visage.
 */
function pop(c: CanvasRenderingContext2D, w: number, h: number) {
  const im = c.getImageData(0, 0, w, h), d = im.data, n = w * h;
  const ch = [0, 1, 2].map((k) => { const a = new Float32Array(n); for (let p = 0; p < n; p++) a[p] = d[4 * p + k]; return a; });
  // Contours sur une image peu lissée (les traits du visage), aplats sur une image très lissée
  const fine = new Float32Array(n);
  for (let p = 0; p < n; p++) fine[p] = 0.299 * ch[0][p] + 0.587 * ch[1][p] + 0.114 * ch[2][p];
  boxBlur(fine, w, h, Math.max(1, Math.round(w / 200)));
  const r = Math.max(1, Math.round(w / 90));
  ch.forEach((a) => boxBlur(a, w, h, r));
  const lum = new Float32Array(n);
  let lo = 255, hi = 0;
  for (let p = 0; p < n; p++) {
    lum[p] = 0.299 * ch[0][p] + 0.587 * ch[1][p] + 0.114 * ch[2][p];
    if (d[4 * p + 3] > 128) { lo = Math.min(lo, lum[p]); hi = Math.max(hi, lum[p]); }
  }
  const span = Math.max(1, hi - lo), TONES = [52, 118, 186, 246];
  // Contours : gradient de la luminance lissée, épaissi
  const ink = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = fine[p + 1 - w] + 2 * fine[p + 1] + fine[p + 1 + w] - fine[p - 1 - w] - 2 * fine[p - 1] - fine[p - 1 + w];
    const gy = fine[p - 1 + w] + 2 * fine[p + w] + fine[p + 1 + w] - fine[p - 1 - w] - 2 * fine[p - w] - fine[p + 1 - w];
    if (Math.hypot(gx, gy) > span * 0.6) ink[p] = 1;
  }
  const t = Math.max(1, Math.round(w / 220));
  const thick = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue;
    for (let dy = -t + 1; dy < t; dy++) for (let dx = -t + 1; dx < t; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) thick[Y * w + X] = 1;
    }
  }
  const step = Math.max(4, w / 38), dot = step * 0.28; // trame de points (tons clairs)
  for (let p = 0; p < n; p++) {
    const i = 4 * p;
    if (thick[p]) { d[i] = 24; d[i + 1] = 20; d[i + 2] = 30; continue; }
    const l = Math.max(1, lum[p]), band = Math.min(3, Math.floor(((lum[p] - lo) / span) * 4));
    let tone = TONES[band];
    if (band === 2) {
      const x = p % w, y = (p - x) / w, u = (x + ((Math.floor(y / step) % 2) * step) / 2) % step - step / 2, v = (y % step) - step / 2;
      if (u * u + v * v < dot * dot) tone *= 0.82;
    }
    for (let k = 0; k < 3; k++) {
      const sat = l + 1.8 * (ch[k][p] - l); // couleur renforcée, puis ramenée à la valeur de la bande
      d[i + k] = Math.min(255, Math.max(0, (sat * tone) / l));
    }
  }
  c.putImageData(im, 0, 0);
}

/** Rendu des visages (ou de la photo du modèle portrait). */
export function applyStyle(c: CanvasRenderingContext2D, w: number, h: number, style: Style) {
  if (style === "pop") pop(c, w, h);
  else if (RAMPS[style]) ramp(c, w, h, RAMPS[style]!);
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
