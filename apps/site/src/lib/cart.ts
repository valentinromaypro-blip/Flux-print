import { getProduct } from "./catalog.ts";
import { sql } from "./db.ts";
import type { Order } from "./orders.ts";
import { orderItems } from "./orders.ts";
import { customerMessages } from "./report.ts";
import { priceFor } from "./pricing.ts";
import type { OrderItem, Product } from "./types.ts";

export function itemPrice(product: Product, item: Pick<OrderItem, "media" | "options" | "copies">) {
  const cards = typeof item.options.cards === "number" ? item.options.cards : undefined;
  return priceFor(product.shop.pricing, { media: item.media, cards, copies: item.copies });
}

export function describeOptions(product: Product, item: Pick<OrderItem, "media" | "options">): string[] {
  const parts: string[] = [];
  for (const [key, spec] of Object.entries(product.options)) {
    const v = item.options[key];
    if (v === undefined) continue;
    parts.push(spec.kind === "choice" ? spec.choices?.[String(v)] ?? String(v) : `${v} cartes`);
  }
  const media = product.media.find((m) => m.code === item.media);
  if (media) parts.push(media.label);
  return parts;
}

/** Vue publique d'une ligne : état, messages du contrôle, aperçus, prix. */
export async function presentItem(item: OrderItem) {
  const product = await getProduct(item.product_code);
  return {
    id: item.id,
    product: item.product_code,
    title: product?.shop.title ?? item.product_code,
    details: product ? describeOptions(product, item) : [],
    copies: item.copies,
    status: item.status,
    // Création en ligne : le RVB vient de notre propre rendu, l'avertissement ne concerne pas le client.
    messages: customerMessages(item.preflight_report, item.design ? ["color.rgb"] : []),
    previews: item.preview_paths.map((p) => `/api/files/previews/${p}`),
    unitPriceCents: item.unit_price_cents,
    totalCents: item.total_cents,
  };
}

export async function presentOrder(order: Order) {
  const items = await Promise.all((await orderItems(order.id)).map(presentItem));
  const total = items.reduce((sum, i) => sum + (i.totalCents ?? 0), 0);
  return {
    number: order.number,
    status: order.status,
    email: order.email,
    items,
    totalCents: total,
    payable: items.length > 0 && items.every((i) => i.status === "approved"),
  };
}

/** Panier ouvert de la session : brouillon, ou commande en attente de paiement (paiement abandonné). */
export async function openOrder(session: string): Promise<Order | null> {
  const [row] = await sql()<Order[]>`
    select * from public.orders where session_token = ${session} and status in ('draft', 'awaiting_payment')
     order by created_at desc limit 1`;
  return row ?? null;
}
