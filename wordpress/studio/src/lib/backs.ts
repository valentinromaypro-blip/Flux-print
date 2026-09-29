// Dos de cartes : mêmes modèles SVG et même remplissage que le moteur (flux_print/design/backs.py).
import { asset } from "@/lib/env.ts";
// L'aperçu du studio et le fichier d'impression partent donc du même dessin.

export type BackModel = {
  id: string; label: string; hint: string; bg: string; ink: string;
  title_max: number; title_box: number; photo?: boolean; logo?: "wanted" | "required"; title_with_logo?: boolean;
};
export const TITLE_MAX = 20, SUBTITLE_MAX = 32;
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

let modelsPromise: Promise<BackModel[]> | null = null;
export const backModels = () => (modelsPromise ??= fetch(asset("backs/models.json")).then((r) => r.json()).then((j) => j.models as BackModel[]));
const templates = new Map<string, Promise<string>>();
export function backTemplate(id: string): Promise<string> {
  if (!templates.has(id)) templates.set(id, fetch(asset(`backs/${id}.svg`)).then((r) => r.text()));
  return templates.get(id)!;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => v.toFixed(2);

/** Valeurs des champs d'un modèle (identique à backs.fields côté moteur). */
export function backFields(m: BackModel, o: { bg: string; ink: string; title: string; subtitle: string; logo?: string | null; tint?: boolean; photo?: string | null }) {
  const title = o.title.trim().slice(0, TITLE_MAX), subtitle = o.subtitle.trim().slice(0, SUBTITLE_MAX);
  const logo = o.logo || null, withLogo = !!m.title_with_logo;
  const titleOn = !!title && (!logo || withLogo), subOn = !!subtitle && (!logo || withLogo);
  const size = Math.min(m.title_max, m.title_box / (0.62 * Math.max(1, title.length)));
  const subSize = Math.min(2.6, 40 / (0.55 * Math.max(1, subtitle.length)));
  const tDy = withLogo ? 0 : subOn ? -0.8 : size * 0.35;
  const on = (b: boolean) => (b ? "inline" : "none");
  return {
    bg: o.bg, ink: o.ink, title: esc(title), subtitle: esc(subtitle),
    title_size: num(size), sub_size: num(subSize), t_dy: num(tDy),
    title_on: on(titleOn), sub_on: on(subOn), logo_on: on(!!logo),
    mark_on: on(!title && !logo && m.id !== "photo"), plate_on: on(titleOn || !!logo),
    logo: logo ?? PIXEL, logo_filter: o.tint && logo ? "url(#tint)" : "none", photo: o.photo || PIXEL,
  } as Record<string, string>;
}

export function fillBack(template: string, values: Record<string, string>, uid = ""): string {
  const svg = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
  // Plusieurs dos dans la même page (galerie) : identifiants rendus uniques
  return uid ? svg.replace(/id="(\w+)"/g, `id="$1-${uid}"`).replace(/url\(#(\w+)\)/g, `url(#$1-${uid})`) : svg;
}
