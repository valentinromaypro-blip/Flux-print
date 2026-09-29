import type { Pricing } from "./types.ts";

export type PriceInput = { media: string; cards?: number; copies: number };
export type Price = { unitCents: number; totalCents: number; tierDiscount: number };

/** Prix d'une ligne : (base + cartes + support) × coefficient de quantité. Calculé côté serveur au panier. */
export function priceFor(pricing: Pricing, input: PriceInput): Price {
  if (!Number.isInteger(input.copies) || input.copies < 1) throw new Error("Quantité invalide.");
  const base = pricing.unit + (pricing.per_card ?? 0) * (input.cards ?? 0) + (pricing.media?.[input.media] ?? 0);
  const tiers = [...pricing.tiers].sort((a, b) => a[0] - b[0]);
  let coef = 1;
  for (const [min, c] of tiers) if (input.copies >= min) coef = c;
  const unitCents = Math.round(base * coef * 100);
  return { unitCents, totalCents: unitCents * input.copies, tierDiscount: Math.round((1 - coef) * 100) };
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Prix d'appel affiché sur les vignettes (1 exemplaire, support par défaut, cartes par défaut). */
export function fromPrice(pricing: Pricing, defaultCards?: number): number {
  return priceFor(pricing, { media: "", cards: defaultCards, copies: 1 }).unitCents;
}
