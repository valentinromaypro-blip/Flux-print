// Modèles de recto : le dessin de chaque carte selon le modèle choisi, pour l'aperçu comme pour
// l'impression (même code, à la taille voulue). Les cartes sont dessinées au format poker, en
// unités de la carte (240 × 336) ; le modèle moderne reprend la maquette du site (635 × 889).
import type { Crop } from "@/lib/design.ts";
import { asset } from "@/lib/env.ts";
import { canvas, cropRect, drawCourt, type Face, faceLayer, faceSlots, loadImage, applyStyle, type Style, vintage } from "@/lib/cardrender.ts";

export type Model = "classique" | "moderne" | "portrait" | "vintage";
export const MODELS: { id: Model; label: string; hint: string; style: Style }[] = [
  { id: "classique", label: "Classique", hint: "Les figures traditionnelles, votre visage à la place du leur.", style: "couleur" },
  { id: "moderne", label: "Moderne", hint: "Illustration à plat et grosse tête : as, chiffres et jokers redessinés, assortis.", style: "couleur" },
  { id: "portrait", label: "Portrait", hint: "La photo occupe toute la figure, dans un cadre à la couleur de la carte. Les figures sans photo restent classiques.", style: "couleur" },
  { id: "vintage", label: "Vintage", hint: "Papier crème et encres passées sur tout le jeu, visages en sépia.", style: "sepia" },
];
export const STYLES: [Style, string][] = [["couleur", "Photo couleur"], ["gravure", "Gravure bleue"], ["nb", "Noir et blanc"], ["sepia", "Sépia"], ["pop", "Pop / BD"]];

/** Cartes du jeu, dans l'ordre de l'atelier (CB_Production::codes). */
export function deckCodes(deck: string): string[] {
  const ranks = deck === "32" ? ["A", "7", "8", "9", "10", "J", "Q", "K"] : ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const codes = ["S", "H", "D", "C"].flatMap((s) => ranks.map((r) => `${s}-${r}`));
  return deck === "32" ? codes : [...codes, "JK-1", "JK-2"];
}
export const isCourt = (code: string) => /-[JQK]$/.test(code);
/** Le modèle redessine-t-il cette carte dans le navigateur (sinon : carte standard de l'atelier) ? */
export const drawnHere = (model: Model, code: string, personalised: boolean) => model === "moderne" || (isCourt(code) && personalised);

/** Cadrage de départ d'une photo posée sur une figure. */
export function startCrop(model: Model, face: Face): Crop {
  if (model === "portrait") return { zoom: 1, x: 0.5, y: 0.4 };
  if (face.cut) return { zoom: model === "moderne" ? 1.25 : 1, x: 0.5, y: 0.5 };
  return { zoom: 2.2, x: 0.5, y: 0.38 };
}
/** La photo telle que le modèle l'utilise : le portrait prend la photo d'origine, pas la tête détourée. */
export const faceFor = (model: Model, face: Face | null): Face | null =>
  face && model === "portrait" ? { url: face.src ?? face.url, cut: false } : face;

// --- Dessin commun -----------------------------------------------------------------------------

const INK = "#16161A", RED = "#C4172C", GOLD = "#BE9646", PAPER = "#FFFFFF";
const SUIT_COLOR: Record<string, string> = { S: INK, H: RED, D: RED, C: INK };
const RANK_FR: Record<string, [string, string]> = { K: ["R", "Roi"], Q: ["D", "Dame"], J: ["V", "Valet"] };

// Enseignes dessinées (pas de police : même rendu partout), dans un carré de 100 centré en (50, 50)
const SUIT_PATH: Record<string, string> = {
  H: "M50 90C22 66 4 50 4 30C4 15 15 6 28 6c10 0 18 6 22 15C54 12 62 6 72 6c13 0 24 9 24 24C96 50 78 66 50 90Z",
  D: "M50 2 86 50 50 98 14 50Z",
  S: "M50 4C62 22 94 38 94 60c0 13-10 22-22 22-8 0-14-3-19-9 1 10 5 18 13 23H34c8-5 12-13 13-23-5 6-11 9-19 9C16 82 6 73 6 60 6 38 38 22 50 4Z",
  C: "M50 6a20 20 0 0 1 17 30 20 20 0 1 1 -12 36c1 10 5 18 13 24H32c8-6 12-14 13-24a20 20 0 1 1 -12-36A20 20 0 0 1 50 6Z",
};
const suitPaths = new Map<string, Path2D>();
function suit(c: CanvasRenderingContext2D, s: string, cx: number, cy: number, size: number, color = SUIT_COLOR[s], flip = false) {
  if (!suitPaths.has(s)) suitPaths.set(s, new Path2D(SUIT_PATH[s]));
  c.save();
  c.translate(cx, cy);
  if (flip) c.rotate(Math.PI);
  c.scale(size / 100, size / 100);
  c.translate(-50, -50);
  c.fillStyle = color;
  c.fill(suitPaths.get(s)!);
  c.restore();
}

async function fontsReady() {
  await Promise.all(['40px "CB Display"', '40px "CB Serif"'].map((f) => document.fonts?.load(f).catch(() => null)));
}

/**
 * Pose une moitié de carte (dessinée par `half`, dans le repère courant de `c`) en haut, puis
 * tournée d'un demi-tour en bas. Calque à la définition du canevas : net à l'impression.
 */
function mirrored(c: CanvasRenderingContext2D, half: (g: CanvasRenderingContext2D) => void) {
  const cv = c.canvas, layer = canvas(cv.width, cv.height), g = layer.getContext("2d")!;
  g.setTransform(c.getTransform());
  half(g);
  c.save(); c.resetTransform();
  c.drawImage(layer, 0, 0);
  c.translate(cv.width, cv.height); c.rotate(Math.PI); c.drawImage(layer, 0, 0);
  c.restore();
}

// --- Modèle moderne (unités 635 × 889, reprises de la maquette du site) -------------------------

const MW = 635, MH = 889;
const PIPS: Record<number, [number, number][]> = {
  2: [[.5, 0], [.5, 1]], 3: [[.5, 0], [.5, .5], [.5, 1]], 4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [.5, .5], [0, 1], [1, 1]], 6: [[0, 0], [1, 0], [0, .5], [1, .5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [.5, .25], [0, .5], [1, .5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [.5, .25], [0, .5], [1, .5], [.5, .75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [.5, .5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [.5, 5 / 6], [0, 1], [1, 1]],
};
/** Emplacement de la grosse tête (unités 635 × 889) : centre, demi-axes. */
const BIG_HEAD = { cx: MW / 2, cy: 262, rx: 86, ry: 100 };
const SKIN = "#EBC6A6", HAIR: Record<string, string> = { K: "#3A2A22", Q: "#7A4E28", J: "#C9A05A" };

function modernIndex(c: CanvasRenderingContext2D, rank: string, s: string) {
  mirrored(c, (g) => {
    g.fillStyle = SUIT_COLOR[s]; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `${rank.length > 1 ? 50 : 58}px "CB Display", sans-serif`;
    g.fillText(rank, 44, 62);
    suit(g, s, 44, 116, 40);
  });
}

function modernNumber(c: CanvasRenderingContext2D, rank: string, s: string) {
  modernIndex(c, rank, s);
  const x0 = 190, x1 = MW - 190, y0 = 190, y1 = MH - 190;
  for (const [fx, fy] of PIPS[+rank]) suit(c, s, x0 + fx * (x1 - x0), y0 + fy * (y1 - y0), 86, SUIT_COLOR[s], fy > 0.5);
}

function modernAce(c: CanvasRenderingContext2D, s: string) {
  modernIndex(c, "A", s);
  suit(c, s, MW / 2, MH / 2 - 20, 300);
  c.fillStyle = SUIT_COLOR[s]; c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `22px "CB Display", sans-serif`;
  c.fillText("CARTE BLANCHE", MW / 2, MH - 170);
}

function modernJoker(c: CanvasRenderingContext2D, n: string) {
  const color = n === "1" ? RED : INK;
  mirrored(c, (g) => {
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `34px "CB Display", sans-serif`;
    [..."JOKER"].forEach((l, i) => g.fillText(l, 44, 70 + i * 34));
  });
  const cx = MW / 2, cy = MH / 2 - 30;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180, r = i % 2 ? 62 : 150;
    c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  c.closePath(); c.fillStyle = color; c.fill();
  c.fillStyle = INK; c.textAlign = "center"; c.font = `30px "CB Serif", Georgia, serif`;
  c.fillText("Le joker de la famille", cx, cy + 230);
}

/** Tête illustrée (figure sans photo). */
function drawnHead(g: CanvasRenderingContext2D, r: string) {
  const { cx, cy, rx, ry } = BIG_HEAD;
  g.fillStyle = HAIR[r];
  if (r === "Q") { g.beginPath(); g.roundRect(cx - rx - 8, cy - ry + 10, 2 * rx + 16, 2 * ry + 20, 70); g.fill(); }
  g.fillStyle = SKIN; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = HAIR[r]; g.beginPath(); g.ellipse(cx, cy - ry * 0.35, rx + 4, ry * 0.7, 0, Math.PI, 0); g.fill();
  if (r === "K") {
    g.beginPath(); g.ellipse(cx, cy + ry * 0.2, rx - 4, ry * 0.8, 0, 0, Math.PI); g.fill();
    g.fillStyle = SKIN; g.fillRect(cx - 22, cy + 26, 44, 12);
  }
  g.fillStyle = INK;
  for (const dx of [-28, 28]) { g.beginPath(); g.arc(cx + dx, cy, 7, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = INK; g.lineWidth = 6; g.lineCap = "round";
  g.beginPath(); g.arc(cx, cy + 22, 24, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
}

function headwear(g: CanvasRenderingContext2D, r: string, color: string) {
  const { cx, cy, ry } = BIG_HEAD, top = cy - ry;
  if (r === "K") {
    g.fillStyle = GOLD; g.beginPath();
    [[-72, 10], [-72, -52], [-36, -22], [0, -64], [36, -22], [72, -52], [72, 10]].forEach(([x, y]) => g.lineTo(cx + x, top + y));
    g.fill();
    g.fillStyle = RED; g.beginPath(); g.arc(cx, top - 22, 9, 0, Math.PI * 2); g.fill();
  } else if (r === "Q") {
    g.fillStyle = GOLD; g.beginPath(); g.ellipse(cx, top + 14, 66, 40, 0, Math.PI, 0); g.fill();
    for (const dx of [-40, 0, 40]) { g.beginPath(); g.arc(cx + dx, top - 30 + Math.abs(dx) / 4, 9, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = color; g.beginPath(); g.roundRect(cx - 88, top - 34, 176, 52, 22); g.fill();
    g.strokeStyle = GOLD; g.lineWidth = 12; g.lineCap = "round";
    g.beginPath(); g.moveTo(cx + 50, top - 26); g.lineTo(cx + 104, top - 62); g.stroke();
  }
}

async function modernCourt(c: CanvasRenderingContext2D, r: string, s: string, face: Face | null, crop: Crop, style: Style) {
  const color = SUIT_COLOR[s], [letter, word] = RANK_FR[r];
  modernIndex(c, letter, s);
  const frame = [96, 96, MW - 96, MH - 96];
  c.strokeStyle = color; c.lineWidth = 4;
  c.beginPath(); c.roundRect(frame[0], frame[1], frame[2] - frame[0], frame[3] - frame[1], 18); c.stroke();
  const img = face ? await loadImage(face.url) : null;
  mirrored(c, (g) => {
    g.save();
    g.beginPath(); g.rect(frame[0] + 4, frame[1] + 4, frame[2] - frame[0] - 8, MH / 2 - frame[1] - 4); g.clip();
    const { cx, cy, rx, ry } = BIG_HEAD;
    // fond teinté, buste (épaules, col, galon, boutons), cou
    g.fillStyle = color; g.globalAlpha = 0.07; g.fillRect(frame[0], frame[1], frame[2] - frame[0], MH / 2 - frame[1]); g.globalAlpha = 1;
    const neck = cy + ry - 14;
    g.fillStyle = SKIN; g.fillRect(cx - 28, neck - 24, 56, 40);
    g.fillStyle = color; g.beginPath(); g.roundRect(cx - 176, neck, 352, 220, [96, 96, 0, 0]); g.fill();
    g.strokeStyle = GOLD; g.lineWidth = 8;
    g.beginPath(); g.roundRect(cx - 160, neck + 16, 320, 220, [82, 82, 0, 0]); g.stroke();
    g.fillStyle = PAPER; g.beginPath(); g.moveTo(cx - 48, neck); g.lineTo(cx, neck + 58); g.lineTo(cx + 48, neck); g.fill();
    g.fillStyle = GOLD;
    for (const y of [neck + 72]) for (const dx of [-14, 14]) { g.beginPath(); g.arc(cx + dx, y, 7, 0, Math.PI * 2); g.fill(); }
    if (img) {
      const px = g.getTransform().a; // pixels par unité : visage dessiné à la définition finale
      const { face: f, ring } = faceLayer(img, face!.cut, crop, 2 * rx * px, 2 * ry * px, 2.6 * px, style, INK);
      const fw = f.width / px, fh = f.height / px;
      g.drawImage(ring, cx - fw / 2, cy - fh / 2, fw, fh); g.drawImage(f, cx - fw / 2, cy - fh / 2, fw, fh);
    } else drawnHead(g, r);
    headwear(g, r, color);
    suit(g, s, frame[0] + 46, frame[1] + 44, 46);
    g.restore();
  });
  c.strokeStyle = color; c.lineWidth = 3;
  c.beginPath(); c.moveTo(frame[0], MH / 2); c.lineTo(frame[2], MH / 2); c.stroke();
  mirrored(c, (g) => {
    const w = 190;
    g.fillStyle = PAPER; g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.roundRect(MW / 2 - w / 2, MH / 2 - 44, w, 38, 19); g.fill(); g.stroke();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `22px "CB Display", sans-serif`;
    g.fillText(word.toUpperCase(), MW / 2, MH / 2 - 24);
  });
}

async function drawModern(target: HTMLCanvasElement, code: string, face: Face | null, crop: Crop, style: Style) {
  await fontsReady();
  const c = target.getContext("2d")!, [s, r] = code.split("-");
  c.save();
  c.fillStyle = PAPER; c.fillRect(0, 0, target.width, target.height);
  c.scale(target.width / MW, target.height / MH);
  if (s === "JK") modernJoker(c, r);
  else if (r === "A") modernAce(c, s);
  else if (isCourt(code)) await modernCourt(c, r, s, face, crop, style);
  else modernNumber(c, r, s);
  c.restore();
}

// --- Modèle portrait (unités 240 × 336) --------------------------------------------------------

const PORTRAIT_BOX = { x: 10, y: 10, w: 220, h: 316 };

/** face null : silhouette d'exemple (vignette du choix de modèle). */
async function drawPortrait(target: HTMLCanvasElement, code: string, face: Face | null, crop: Crop, style: Style) {
  await fontsReady();
  const W = target.width, H = target.height, k = W / 240, [s, r] = code.split("-"), color = SUIT_COLOR[s];
  const c = target.getContext("2d")!;
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
  const { x, y, w, h } = PORTRAIT_BOX;
  const photo = canvas(w * k, h * k), g = photo.getContext("2d", { willReadFrequently: true })!;
  if (face) {
    const img = await loadImage(face.url);
    g.drawImage(img, ...cropRect(img.naturalWidth, img.naturalHeight, crop, w / h), 0, 0, photo.width, photo.height);
    applyStyle(g, photo.width, photo.height, style);
  } else {
    g.fillStyle = "#D9D6CF"; g.fillRect(0, 0, photo.width, photo.height);
    g.fillStyle = "#F4F2EE"; g.scale(k, k);
    g.beginPath(); g.ellipse(w / 2, h * 0.36, 44, 54, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w / 2, h * 0.98, 100, 110, 0, Math.PI, 0); g.fill();
  }
  c.save();
  c.beginPath(); c.roundRect(x * k, y * k, w * k, h * k, 8 * k); c.clip();
  c.drawImage(photo, x * k, y * k);
  c.restore();
  c.strokeStyle = color; c.lineWidth = 2.4 * k;
  c.beginPath(); c.roundRect(x * k, y * k, w * k, h * k, 8 * k); c.stroke();
  mirrored(c, (p) => {
    p.fillStyle = "rgba(255,255,255,.92)";
    p.beginPath(); p.roundRect(17 * k, 17 * k, 26 * k, 44 * k, 6 * k); p.fill();
    p.fillStyle = color; p.textAlign = "center"; p.textBaseline = "middle"; p.font = `${20 * k}px "CB Display", sans-serif`;
    p.fillText(RANK_FR[r][0], 30 * k, 30 * k);
    suit(p, s, 30 * k, 49 * k, 14 * k);
  });
}

// --- Cartes standard de l'atelier (aperçu seulement) ----------------------------------------------

/** Face standard classique, rognée au format fini (le fichier comprend 3 mm de fond perdu). */
async function drawStandard(target: HTMLCanvasElement, code: string) {
  const img = await loadImage(asset(`../engine/fronts/${code}.jpg`));
  const bx = (img.naturalWidth * 3) / 69.5, by = (img.naturalHeight * 3) / 94.9;
  const c = target.getContext("2d")!;
  c.drawImage(img, bx, by, img.naturalWidth - 2 * bx, img.naturalHeight - 2 * by, 0, 0, target.width, target.height);
}

/**
 * Une carte du jeu, dans le modèle choisi. `face` : la photo posée sur la figure (ou null).
 * Hors modèle moderne, les cartes non figures sont les cartes standard de l'atelier.
 */
export async function drawCard(target: HTMLCanvasElement, model: Model, code: string, face: Face | null, crop: Crop, style: Style, sample = false) {
  const f = faceFor(model, face);
  if (model === "moderne") return drawModern(target, code, f, crop, style);
  if (!isCourt(code)) await drawStandard(target, code);
  else if (model === "portrait" && (f || sample)) await drawPortrait(target, code, f, crop, style);
  else await drawCourt(target, code, f, crop, style);
  if (model === "vintage") vintage(target.getContext("2d", { willReadFrequently: true })!, target.width, target.height);
}

/** Zone que l'on déplace à la souris dans le grand aperçu (pixels d'un canevas de `width` de large). */
export async function dragBox(model: Model, code: string, width: number) {
  if (model === "moderne") {
    const k = width / MW, { cx, cy, rx, ry } = BIG_HEAD;
    return { x: (cx - rx) * k, y: (cy - ry) * k, w: 2 * rx * k, h: 2 * ry * k };
  }
  if (model === "portrait") {
    const k = width / 240, { x, y, w, h } = PORTRAIT_BOX;
    return { x: x * k, y: y * k, w: w * k, h: h * k };
  }
  const [cx, cy, rx, ry] = (await faceSlots())[code.replace("-", "")];
  const k = width / 240;
  return { x: (cx - rx) * k, y: (cy - ry) * k, w: 2 * rx * k, h: 2 * ry * k };
}
