import type { Order } from "../orders.ts";
import type { OrderItem } from "../types.ts";

// Prestataire de paiement interchangeable : PAYMENT_PROVIDER=test | stripe | revolut.
export type CheckoutSession = { redirectUrl: string; reference: string };

export interface PaymentProvider {
  name: string;
  createCheckout(order: Order, items: (OrderItem & { title: string })[], siteUrl: string): Promise<CheckoutSession>;
  /** Vérifie un webhook et renvoie le paiement confirmé, ou null si l'événement ne confirme rien. */
  verifyWebhook(request: Request): Promise<{ orderId: string; reference: string; amountCents: number } | null>;
}

export async function paymentProvider(): Promise<PaymentProvider> {
  const name = process.env.PAYMENT_PROVIDER ?? "test";
  if (name === "stripe") return new (await import("./stripe.ts")).StripeProvider();
  if (name === "revolut") return new (await import("./revolut.ts")).RevolutProvider();
  if (name === "test") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PAYMENTS !== "true") {
      throw new Error("Paiement de test désactivé en production.");
    }
    return new (await import("./test.ts")).TestProvider();
  }
  throw new Error(`Prestataire de paiement inconnu : ${name}`);
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
