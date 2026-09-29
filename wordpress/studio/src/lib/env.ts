// Réglages passés par WordPress (wp_localize_script) au studio.
export type Media = { id: string; label: string; hint: string; delta: number };
export type Spec = {
  cards: number; cardsMin: number | null; cardsMax: number | null; backs: "common" | "individual"; editor: boolean;
  media: Media[]; formats: { label: string; page: [number, number] }[];
  pricing: { unit: number; per_card: number; tiers: [number, number][] };
};
type Env = { spec: Spec; image: string; rest: string; nonce: string; assets: string; productId: number; deck: string; cardPx: [number, number]; bleedMm: number };
export const CB = (window as unknown as { CarteBlanche: Env }).CarteBlanche;
export const asset = (path: string) => CB.assets + path;
