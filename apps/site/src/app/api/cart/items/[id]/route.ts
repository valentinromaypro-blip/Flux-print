import { itemPrice, presentItem } from "@/lib/cart.ts";
import { getProduct } from "@/lib/catalog.ts";
import { sql } from "@/lib/db.ts";
import { body, fail, json } from "@/lib/http.ts";
import { sessionItem } from "@/lib/orders.ts";
import { readSession } from "@/lib/session.ts";

type Params = { params: Promise<{ id: string }> };

async function owned(id: string) {
  const session = await readSession();
  return session ? sessionItem(session, id) : null;
}

export async function GET(_: Request, { params }: Params) {
  const item = await owned((await params).id);
  return item ? json(await presentItem(item)) : fail("Introuvable.", 404);
}

/** Changer la quantité (prix recalculé côté serveur). */
export async function PATCH(request: Request, { params }: Params) {
  const item = await owned((await params).id);
  if (!item) return fail("Introuvable.", 404);
  const { copies } = await body<{ copies: number }>(request);
  if (!Number.isInteger(copies) || copies < 1 || copies > 500) return fail("Quantité invalide (1 à 500).");
  const product = await getProduct(item.product_code);
  if (!product) return fail("Produit indisponible.", 410);
  const price = itemPrice(product, { ...item, copies });
  const rows = await sql()`
    update public.order_items i set copies = ${copies}, unit_price_cents = ${price.unitCents},
           total_cents = ${price.totalCents}
      from public.orders o
     where i.id = ${item.id} and o.id = i.order_id and o.status = 'draft'
    returning i.id`;
  return rows.length ? json({ ok: true }) : fail("Commande déjà validée.", 409);
}

export async function DELETE(_: Request, { params }: Params) {
  const item = await owned((await params).id);
  if (!item) return fail("Introuvable.", 404);
  const rows = await sql()`
    delete from public.order_items i using public.orders o
     where i.id = ${item.id} and o.id = i.order_id and o.status = 'draft' returning i.id`;
  return rows.length ? json({ ok: true }) : fail("Commande déjà validée.", 409);
}
