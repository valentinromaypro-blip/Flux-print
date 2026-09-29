// Réglages passés par WordPress (wp_localize_script) au studio.
type Env = { rest: string; nonce: string; assets: string; productId: number; deck: string; cardPx: [number, number]; bleedMm: number };
export const CB = (window as unknown as { CarteBlanche: Env }).CarteBlanche;
export const asset = (path: string) => CB.assets + path;
