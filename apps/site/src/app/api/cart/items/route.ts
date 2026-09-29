import { itemPrice, openOrder, presentOrder } from "@/lib/cart.ts";
import { cleanOptions, getProduct } from "@/lib/catalog.ts";
import { sql } from "@/lib/db.ts";
import { body, fail, json } from "@/lib/http.ts";
import { draftOrder, logEvent } from "@/lib/orders.ts";
import { ensureSession, readSession } from "@/lib/session.ts";
import { exists } from "@/lib/storage.ts";
import type { OrderItem } from "@/lib/types.ts";

export async function GET() {
  const session = await readSession();
  const order = session ? await openOrder(session) : null;
  return json(order ? await presentOrder(order) : { items: [], totalCents: 0, payable: false });
}

/** Ajoute au panier un fichier déposé : la ligne part aussitôt au contrôle (worker). */
export async function POST(request: Request) {
  try {
    const input = await body<{ product: string; media: string; options: Record<string, unknown>; copies: number;
      path: string }>(request);
    const session = await ensureSession();
    const product = await getProduct(input.product);
    if (!product) return fail("Produit inconnu.", 404);
    if (!product.media.some((m) => m.code === input.media)) return fail("Support invalide.");
    const copies = Number(input.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 500) return fail("Quantité invalide (1 à 500).");
    const options = cleanOptions(product, input.options ?? {});
    if (!input.path?.startsWith(`sessions/${session}/`) || !(await exists("uploads", input.path))) {
      return fail("Fichier introuvable : déposez-le à nouveau.");
    }
    // Paiement abandonné : le panier redevient modifiable.
    await sql()`update public.orders set status = 'draft'
                 where session_token = ${session} and status = 'awaiting_payment'`;
    const order = await draftOrder(session, true);
    if (!order) return fail("Panier indisponible.", 500);
    const price = itemPrice(product, { media: input.media, options, copies });
    const [item] = await sql()<OrderItem[]>`
      insert into public.order_items (order_id, product_code, media, copies, source_path, options,
                                      unit_price_cents, total_cents)
      values (${order.id}, ${product.code}, ${input.media}, ${copies}, ${input.path}, ${sql().json(options)},
              ${price.unitCents}, ${price.totalCents})
      returning *`;
    await logEvent("item", item.id, "uploaded", { product: product.code, options, copies });
    return json({ id: item.id }, 201);
  } catch (e) {
    return fail((e as Error).message);
  }
}
