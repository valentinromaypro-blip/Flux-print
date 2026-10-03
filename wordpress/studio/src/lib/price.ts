// Prix affiché pendant la création : même calcul que le serveur (CB_Settings::price), qui reste
// la référence au panier. Grille du jeu, carton, remise quantité, puis étui (hors remise).
import { CB } from "@/lib/env.ts";

export function estimate(cards: number, media: string, pack: string, qty = 1) {
  const p = CB.spec.pricing as { unit: number; per_card: number; tiers: [number, number][]; media?: Record<string, number> };
  const base = p.unit + p.per_card * cards + (p.media?.[media] ?? 0);
  const coef = p.tiers.reduce((c, [min, k]) => (qty >= min ? k : c), 1);
  const extra = CB.spec.packs.find((x) => x.id === pack)?.price ?? 0;
  const unit = Math.round((base * coef + extra) * 100) / 100;
  return { unit, total: Math.round(unit * qty * 100) / 100, discount: Math.round((1 - coef) * 100) };
}
export const euros = (v: number) => v.toFixed(2).replace(".", ",") + " €";
