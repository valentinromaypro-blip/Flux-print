export type Crop = { zoom: number; x: number; y: number };
export const SUITS = [["S", "♠", "pique"], ["H", "♥", "cœur"], ["D", "♦", "carreau"], ["C", "♣", "trèfle"]] as const;
export const RANKS = [["J", "V", "Valet"], ["Q", "D", "Dame"], ["K", "R", "Roi"]] as const;

/** Identifiant local unique. crypto.randomUUID n'existe qu'en HTTPS : repli pour les sites en http. */
let seq = 0;
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
