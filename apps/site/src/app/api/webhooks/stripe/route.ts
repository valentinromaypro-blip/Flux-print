import { fail, json } from "@/lib/http.ts";
import { markPaid } from "@/lib/orders.ts";
import { paymentProvider } from "@/lib/payments/index.ts";

export async function POST(request: Request) {
  const provider = await paymentProvider();
  if (provider.name !== "stripe") return fail("Prestataire inactif.", 404);
  try {
    const paid = await provider.verifyWebhook(request);
    if (paid) await markPaid(paid.orderId, "stripe", paid.reference, paid.amountCents);
    return json({ received: true });
  } catch (e) {
    return fail((e as Error).message, 400);
  }
}
