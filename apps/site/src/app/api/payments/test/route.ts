import { body, fail, json } from "@/lib/http.ts";
import { markPaid, orderByNumber } from "@/lib/orders.ts";
import { readSession } from "@/lib/session.ts";

/** Confirmation du paiement simulé (PAYMENT_PROVIDER=test uniquement). */
export async function POST(request: Request) {
  if ((process.env.PAYMENT_PROVIDER ?? "test") !== "test") return fail("Indisponible.", 404);
  const session = await readSession();
  const { number } = await body<{ number: string }>(request);
  const order = session ? await orderByNumber(session, number) : null;
  if (!order) return fail("Commande introuvable.", 404);
  const ok = await markPaid(order.id, "test", order.payment_ref ?? "test", order.total_cents);
  return ok ? json({ ok: true }) : fail("Paiement impossible pour cette commande.", 409);
}
