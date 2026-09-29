// Cartes à la taille d'impression (fond perdu compris), fabriquées dans le navigateur à partir des
// mêmes dessins que l'aperçu : seules ces images partent au serveur, pas les photos d'origine.
import type { StudioPayload } from "@/components/Editor";
import { BACK_RATIO } from "@/components/BackStep";
import { backFields, backTemplate, fillBack } from "@/lib/backs.ts";
import { drawCourt, loadImage, type Style } from "@/lib/cardrender.ts";
import type { Crop } from "@/lib/design.ts";
import { asset, CB } from "@/lib/env.ts";

const TRIM_MM = [63.5, 88.9];
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
  const w = img.naturalWidth, h = img.naturalHeight, r = BACK_RATIO;
  const cw = Math.min(w, h * r) / Math.max(1, crop.zoom), ch = cw / r;
  const cx = Math.min(Math.max(crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(crop.y * h, ch / 2), h - ch / 2);
  const c = canvas(width, Math.round(width / r));
  c.getContext("2d")!.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.93);
}

/** Le dos, pleine page (fond perdu compris). */
export async function renderBack(p: StudioPayload): Promise<Blob> {
  const [W, H] = CB.cardPx;
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

/** Une figure personnalisée : dessin au format fini, centré sur un fond perdu blanc. */
export async function renderCourt(court: StudioPayload["courts"][number], style: Style): Promise<Blob> {
  const [W, H] = CB.cardPx;
  const bleed = CB.bleedMm, tw = Math.round((W * TRIM_MM[0]) / (TRIM_MM[0] + 2 * bleed)), th = Math.round((H * TRIM_MM[1]) / (TRIM_MM[1] + 2 * bleed));
  const trim = canvas(tw, th);
  await drawCourt(trim, court.code, court.face, court.crop, style);
  const c = canvas(W, H), g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.drawImage(trim, (W - tw) / 2, (H - th) / 2);
  return jpeg(c);
}
