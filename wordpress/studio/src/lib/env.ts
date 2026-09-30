// Réglages passés par WordPress (wp_localize_script) au studio.
export type Media = { id: string; label: string; hint: string; delta: number };
export type Spec = {
  cards: number; cardsMin: number | null; cardsMax: number | null; backs: "common" | "individual"; editor: boolean;
  media: Media[]; formats: { key: string; label: string; trim: [number, number]; page: [number, number] }[];
  pricing: { unit: number; per_card: number; tiers: [number, number][] };
  packs: { id: "film" | "fenetre" | "custom"; label: string; hint: string; price: number; photo: string; formats: string[] | null }[];
  caliper: Record<string, number>;
};
type Env = { spec: Spec; image: string; mediapipe: string; rest: string; nonce: string; assets: string; productId: number; deck: string; cardPx: [number, number]; bleedMm: number };
export const CB = (window as unknown as { CarteBlanche: Env }).CarteBlanche;
export const asset = (path: string) => CB.assets + path;
