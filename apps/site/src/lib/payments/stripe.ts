import type { Order } from "../orders.ts";
import type { OrderItem } from "../types.ts";
import { type CheckoutSession, hmacHex, type PaymentProvider, safeEqual } from "./index.ts";

// Stripe Checkout (page de paiement hébergée), via l'API REST : aucune dépendance.
export class StripeProvider implements PaymentProvider {
  name = "stripe";
  private key = process.env.STRIPE_SECRET_KEY ?? "";

  async createCheckout(order: Order, items: (OrderItem & { title: string })[], siteUrl: string): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: "payment",
      "success_url": `${siteUrl}/commande/${order.number}?paiement=ok`,
      "cancel_url": `${siteUrl}/panier`,
      "customer_email": order.email ?? "",
      "client_reference_id": order.id,
      "metadata[order_id]": order.id,
      "payment_intent_data[metadata][order_id]": order.id,
    });
    items.forEach((item, i) => {
      form.set(`line_items[${i}][quantity]`, String(item.copies));
      form.set(`line_items[${i}][price_data][currency]`, "eur");
      form.set(`line_items[${i}][price_data][unit_amount]`, String(item.unit_price_cents));
      form.set(`line_items[${i}][price_data][product_data][name]`, item.title);
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `checkout-${order.id}-${order.total_cents}` },
      body: form,
    });
    const body = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !body.url || !body.id) throw new Error(`Stripe : ${body.error?.message ?? res.status}`);
    return { redirectUrl: body.url, reference: body.id };
  }

  async verifyWebhook(request: Request) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    const payload = await request.text();
    const header = request.headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
    const timestamp = Number(parts.t);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return null;
    const expected = await hmacHex(secret, `${parts.t}.${payload}`);
    const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
    if (!signatures.some((s) => safeEqual(s, expected))) throw new Error("Signature Stripe invalide.");
    const event = JSON.parse(payload) as {
      type: string;
      data: { object: { id: string; payment_status?: string; amount_total?: number; metadata?: { order_id?: string } } };
    };
    const session = event.data.object;
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
    if (session.payment_status !== "paid" || !session.metadata?.order_id) return null;
    return { orderId: session.metadata.order_id, reference: session.id, amountCents: session.amount_total ?? -1 };
  }
}
