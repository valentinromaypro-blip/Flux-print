// Cartes à la taille d'impression (fond perdu compris), fabriquées dans le navigateur à partir des
// mêmes dessins que l'aperçu : seules ces images partent au serveur, pas les photos d'origine.
import type { StudioPayload } from "@/components/Editor";
import { backFields, backTemplate, fillBack } from "@/lib/backs.ts";
import { drawCourt, loadImage, RATIO, type Style } from "@/lib/cardrender.ts";
import type { Crop } from "@/lib/design.ts";
import { asset } from "@/lib/env.ts";
import { backRatio, pagePx, trimPx } from "@/lib/format.ts";

const FONTS: [string, string][] = [["CB Serif", "cb-serif"], ["CB Display", "cb-display"], ["CB Sans", "cb-sans"]];

function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
const jpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Rendu de la carte impossible."))), "image/jpeg", 0.93));

async function dataUrl(blob: Blob): Promise<string> {
  return await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = ko; r.readAsDataURL(blob); });
}
const fetchData = async (url: string) => dataUrl(await (await fetch(url)).blob());

// Une image SVG ne voit pas les polices de la page : on les embarque dans le SVG.
let fontCss: Promise<string> | null = null;
const fonts = () => (fontCss ??= Promise.all(FONTS.map(async ([family, file]) =>
  `@font-face{font-family:"${family}";src:url(${await fetchData(asset(`backs/fonts/${file}.ttf`))}) format("truetype")}`)).then((r) => r.join("")));

/** Photo du dos recadrée comme l'aperçu, à la définition d'impression. */
async function croppedPhoto(url: string, crop: Crop, width: number): Promise<string> {
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight, r = backRatio();
  const cw = Math.min(w, h * r) / Math.max(1, crop.zoom), ch = cw / r;
  const cx = Math.min(Math.max(crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(crop.y * h, ch / 2), h - ch / 2);
  const c = canvas(width, Math.round(width / r));
  c.getContext("2d")!.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.93);
}

/** Le dos, pleine page (fond perdu compris). */
export async function renderBack(p: Pick<StudioPayload, "back" | "model">): Promise<Blob> {
  const [W, H] = pagePx();
  const { back, model } = p;
  const [template, css, logo, photo] = await Promise.all([
    backTemplate(model.id), fonts(),
    back.logo ? fetchData(back.logo.url) : null,
    back.photo && model.photo ? croppedPhoto(back.photo.url, back.crop, W) : null,
  ]);
  const svg = fillBack(template, backFields(model, {
    bg: back.bg, ink: back.ink, title: back.title, subtitle: back.subtitle, logo, tint: back.tint && !!back.logo?.alpha, photo,
  })).replace(/<svg\b[^>]*>/, (open) => `${open}<style>${css}</style>`);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const c = canvas(W, H), g = c.getContext("2d")!;
  g.fillStyle = back.bg; g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);
  return jpeg(c);
}

/**
 * Une figure personnalisée : dessin au format fini, centré sur un fond perdu blanc.
 * Les figures sont dessinées au format poker ; sur un format plus étroit (bridge), le dessin
 * garde ses proportions, calé sur la largeur et centré en hauteur.
 */
export async function renderCourt(court: StudioPayload["courts"][number], style: Style): Promise<Blob> {
  const [W, H] = pagePx();
  const [tw, th] = trimPx();
  const art = canvas(tw, Math.min(th, Math.round(tw * RATIO)));
  await drawCourt(art, court.code, court.face, court.crop, style);
  const c = canvas(W, H), g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.drawImage(art, (W - art.width) / 2, (H - art.height) / 2);
  return jpeg(c);
}

export type FreeCard = { url: string; crop: Crop; title: string };
export type CardLook = { frame: boolean; band: boolean; bg: string; ink: string };

/**
 * Une carte libre (oracle) : image pleine page (fond perdu compris), filet et bandeau de titre
 * facultatifs, tenus dans la zone de sécurité (4 mm à l'intérieur de la coupe).
 * `target` : aperçu (n'importe quelle taille) ou fichier d'impression.
 */
export async function drawFreeCard(target: HTMLCanvasElement, card: FreeCard, look: CardLook, bleedFrac: [number, number]) {
  const W = target.width, H = target.height, g = target.getContext("2d")!;
  g.fillStyle = look.bg; g.fillRect(0, 0, W, H);
  if (card.url) {
    const img = await loadImage(card.url);
    const r = W / H, w = img.naturalWidth, h = img.naturalHeight;
    const cw = Math.min(w, h * r) / Math.max(1, card.crop.zoom), ch = cw / r;
    const cx = Math.min(Math.max(card.crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(card.crop.y * h, ch / 2), h - ch / 2);
    g.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, W, H);
  }
  // Repères en fraction de la page : fond perdu, puis zone de sécurité
  const bx = bleedFrac[0] * W, by = bleedFrac[1] * H, safe = (bx / 3) * 4; // 4 mm (le fond perdu fait 3 mm)
  const unit = bx / 3; // 1 mm
  if (look.frame) {
    g.strokeStyle = look.ink; g.lineWidth = Math.max(1, 0.35 * unit);
    const m = bx + safe;
    g.beginPath(); g.roundRect(m, by + safe, W - 2 * m, H - 2 * (by + safe), 1.5 * unit); g.stroke();
  }
  if (look.band && card.title.trim()) {
    await document.fonts?.load(`20px "CB Serif"`).catch(() => {});
    const bandH = 11 * unit, y = H - by - safe - bandH, x = bx + safe;
    g.fillStyle = look.bg; g.globalAlpha = 0.92;
    g.beginPath(); g.roundRect(x, y, W - 2 * x, bandH, 1.2 * unit); g.fill(); g.globalAlpha = 1;
    g.fillStyle = look.ink; g.textAlign = "center"; g.textBaseline = "middle";
    let size = 5.2 * unit;
    g.font = `${size}px "CB Serif", Georgia, serif`;
    while (g.measureText(card.title).width > W - 2 * x - 4 * unit && size > 2 * unit) { size *= 0.94; g.font = `${size}px "CB Serif", Georgia, serif`; }
    g.fillText(card.title.trim(), W / 2, y + bandH / 2 + 0.3 * unit);
  }
}

export async function renderFreeCard(card: FreeCard, look: CardLook, bleedFrac: [number, number]): Promise<Blob> {
  const [W, H] = pagePx();
  const c = canvas(W, H);
  await drawFreeCard(c, card, look, bleedFrac);
  return jpeg(c);
}
