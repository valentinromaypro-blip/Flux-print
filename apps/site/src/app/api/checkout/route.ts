import { itemPrice, openOrder } from "@/lib/cart.ts";
import { getProduct } from "@/lib/catalog.ts";
import { sql } from "@/lib/db.ts";
import { body, fail, json } from "@/lib/http.ts";
import { logEvent, orderItems } from "@/lib/orders.ts";
import { paymentProvider } from "@/lib/payments/index.ts";
import { readSession } from "@/lib/session.ts";
import type { OrderItem } from "@/lib/types.ts";

type Address = { name: string; line1: string; line2?: string; postal_code: string; city: string; country: string };

/** Valide le panier (fichiers approuvés, prix recalculés) puis ouvre le paiement. */
export async function POST(request: Request) {
  try {
    const session = await readSession();
    const order = session ? await openOrder(session) : null;
    if (!order) return fail("Votre panier est vide.", 404);
    const input = await body<{ email: string; address: Address }>(request);
    const email = String(input.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Adresse e-mail invalide.");
    const a = input.address ?? ({} as Address);
    if (![a.name, a.line1, a.postal_code, a.city, a.country].every((v) => typeof v === "string" && v.trim())) {
      return fail("Adresse de livraison incomplète.");
    }
    const items = await orderItems(order.id);
    if (!items.length) return fail("Votre panier est vide.");
    const pending = items.filter((i) => i.status !== "approved");
    if (pending.length) return fail("Tous les fichiers doivent être validés avant le paiement.", 409);

    const priced: (OrderItem & { title: string })[] = [];
    let total = 0;
    for (const item of items) {
      const product = await getProduct(item.product_code);
      if (!product) return fail("Un produit du panier n'est plus disponible.", 410);
      const price = itemPrice(product, item);
      total += price.totalCents;
      priced.push({ ...item, unit_price_cents: price.unitCents, total_cents: price.totalCents, title: product.shop.title });
    }
    const provider = await paymentProvider();
    const db = sql();
    await db.begin(async (tx) => {
      for (const i of priced) {
        await tx`update public.order_items set unit_price_cents = ${i.unit_price_cents}, total_cents = ${i.total_cents}
                  where id = ${i.id}`;
      }
      await tx`update public.orders set email = ${email}, shipping_address = ${tx.json(a)}, total_cents = ${total},
                 status = 'awaiting_payment', payment_provider = ${provider.name} where id = ${order.id}`;
    });
    const siteUrl = process.env.SITE_URL ?? new URL(request.url).origin;
    const checkout = await provider.createCheckout({ ...order, email, total_cents: total }, priced, siteUrl);
    await db`update public.orders set payment_ref = ${checkout.reference} where id = ${order.id}`;
    await logEvent("order", order.id, "checkout", { provider: provider.name, total });
    return json({ redirectUrl: checkout.redirectUrl });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
