// Design d'un jeu créé en ligne (même forme que flux_print/design/render.py, revalidé par le worker).
export type Crop = { zoom: number; x: number; y: number };
export type PhotoRef = Crop & { path: string };
export type Design = {
  back: { color: string; ink: string; title: string; subtitle: string; photo: PhotoRef | null };
  style: "gravure" | "couleur"; // traitement des visages sur les figures
  courts: Record<string, { name: string; photo: PhotoRef | null }>;
};

export const SUITS = [["S", "♠", "pique"], ["H", "♥", "cœur"], ["D", "♦", "carreau"], ["C", "♣", "trèfle"]] as const;
export const RANKS = [["J", "V", "Valet"], ["Q", "D", "Dame"], ["K", "R", "Roi"]] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

function photo(p: unknown, session: string): PhotoRef | null {
  if (p == null) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path.startsWith(`sessions/${session}/photos/`)) throw new Error("Photo invalide : déposez-la à nouveau.");
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = v === undefined ? d : Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error("Recadrage invalide.");
    return n;
  };
  return { path: o.path, zoom: num(o.zoom, 1, 4, 1), x: num(o.x, 0, 1, 0.5), y: num(o.y, 0, 1, 0.5) };
}

/** Nettoie un design reçu du navigateur ; lève une erreur lisible si quelque chose ne va pas. */
export function cleanDesign(input: unknown, session: string): Design {
  const d = (input ?? {}) as { back?: Record<string, unknown>; style?: unknown; courts?: Record<string, Record<string, unknown>> };
  const b = d.back ?? {};
  const color = String(b.color ?? "#134536"), ink = String(b.ink ?? "#F0E8D6");
  if (!HEX.test(color) || !HEX.test(ink)) throw new Error("Couleur invalide.");
  const valid = new Set(SUITS.flatMap(([s]) => RANKS.map(([r]) => `${s}-${r}`)));
  const courts: Design["courts"] = {};
  for (const [code, c] of Object.entries(d.courts ?? {})) {
    if (!valid.has(code)) throw new Error("Figure inconnue.");
    const name = String(c?.name ?? "").trim().slice(0, 14);
    const ph = photo(c?.photo, session);
    if (name || ph) courts[code] = { name, photo: ph };
  }
  const style = d.style ?? "couleur";
  if (style !== "gravure" && style !== "couleur") throw new Error("Style inconnu.");
  return {
    style,
    back: { color, ink, title: String(b.title ?? "").slice(0, 12), subtitle: String(b.subtitle ?? "").slice(0, 24), photo: photo(b.photo, session) },
    courts,
  };
}

export function designPhotos(d: Design): string[] {
  return [d.back.photo, ...Object.values(d.courts).map((c) => c.photo)].filter((p): p is PhotoRef => !!p).map((p) => p.path);
}
