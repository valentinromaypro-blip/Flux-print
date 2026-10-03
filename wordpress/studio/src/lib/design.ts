export type Crop = { zoom: number; x: number; y: number };
export const SUITS = [["S", "♠", "pique"], ["H", "♥", "cœur"], ["D", "♦", "carreau"], ["C", "♣", "trèfle"]] as const;
export const RANKS = [["J", "V", "Valet"], ["Q", "D", "Dame"], ["K", "R", "Roi"]] as const;

/** Identifiant local unique. crypto.randomUUID n'existe qu'en HTTPS : repli pour les sites en http. */
let seq = 0;
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/**
 * Au changement d'étape du studio : ramène le haut du panneau à l'écran (sous l'en-tête collant
 * du site), sans bouger si l'utilisateur le voit déjà. Rien au premier affichage.
 */
export function revealPanel(panel: HTMLElement | null, first: { current: boolean }) {
  if (first.current) { first.current = false; return; }
  if (!panel) return;
  const header = document.querySelector<HTMLElement>(".cb-header, header.wp-block-template-part, .site-header");
  // Sous l'en-tête collant du site et, sur mobile, sous l'aperçu collé au-dessus du panneau
  const stage = panel.parentElement?.querySelector<HTMLElement>(":scope > .stage-col");
  const stacked = stage && getComputedStyle(stage).position === "sticky" && stage.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top + 1;
  const offset = Math.max(0, header?.getBoundingClientRect().bottom ?? 0) + (stacked ? stage.getBoundingClientRect().height : 0) + 16;
  const target = panel.querySelector<HTMLElement>(".steps") ?? panel; // la barre des étapes, pas le titre du produit
  const top = target.getBoundingClientRect().top;
  if (top < offset || top > window.innerHeight * 0.4) window.scrollTo({ top: window.scrollY + top - offset, behavior: "smooth" });
}
