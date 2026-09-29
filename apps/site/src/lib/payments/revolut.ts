import type { Order } from "../orders.ts";
import { type CheckoutSession, hmacHex, type PaymentProvider, safeEqual } from "./index.ts";

// Revolut Business, API Merchant : création d'une commande puis redirection vers sa page de paiement.
// À valider en bac à sable (REVOLUT_SANDBOX=true) avant la mise en production.
const API_VERSION = "2024-09-01";

export class RevolutProvider implements PaymentProvider {
  name = "revolut";
  private key = process.env.REVOLUT_SECRET_KEY ?? "";
  private base = process.env.REVOLUT_SANDBOX === "false"
    ? "https://merchant.revolut.com/api"
    : "https://sandbox-merchant.revolut.com/api";

  private headers() {
    return { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "Revolut-Api-Version": API_VERSION };
  }

  async createCheckout(order: Order, _items: unknown[], siteUrl: string): Promise<CheckoutSession> {
    const res = await fetch(`${this.base}/orders`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        amount: order.total_cents,
        currency: "EUR",
        description: `Commande ${order.number}`,
        customer: order.email ? { email: order.email } : undefined,
        merchant_order_data: { reference: order.id },
        redirect_url: `${siteUrl}/commande/${order.number}?paiement=ok`,
      }),
    });
    const body = (await res.json()) as { id?: string; checkout_url?: string; message?: string };
    if (!res.ok || !body.id || !body.checkout_url) throw new Error(`Revolut : ${body.message ?? res.status}`);
    return { redirectUrl: body.checkout_url, reference: body.id };
  }

  async verifyWebhook(request: Request) {
    const secret = process.env.REVOLUT_WEBHOOK_SECRET ?? "";
    const payload = await request.text();
    const timestamp = request.headers.get("revolut-request-timestamp") ?? "";
    if (!timestamp || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return null;
    const expected = `v1=${await hmacHex(secret, `v1.${timestamp}.${payload}`)}`;
    const signatures = (request.headers.get("revolut-signature") ?? "").split(",").map((s) => s.trim());
    if (!signatures.some((s) => safeEqual(s, expected))) throw new Error("Signature Revolut invalide.");
    const event = JSON.parse(payload) as { event: string; order_id: string };
    if (event.event !== "ORDER_COMPLETED") return null;
    // Le montant et la référence viennent de l'API Revolut, pas du webhook.
    const res = await fetch(`${this.base}/orders/${event.order_id}`, { headers: this.headers() });
    const order = (await res.json()) as { id: string; state: string; amount: number;
      merchant_order_data?: { reference?: string } };
    if (!res.ok || order.state !== "completed" || !order.merchant_order_data?.reference) return null;
    return { orderId: order.merchant_order_data.reference, reference: order.id, amountCents: order.amount };
  }
}
