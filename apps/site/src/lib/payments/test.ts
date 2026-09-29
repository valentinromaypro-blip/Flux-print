import type { Order } from "../orders.ts";
import type { CheckoutSession, PaymentProvider } from "./index.ts";

/** Paiement simulé (développement) : une page de confirmation interne remplace la banque. */
export class TestProvider implements PaymentProvider {
  name = "test";
  async createCheckout(order: Order): Promise<CheckoutSession> {
    const reference = `test_${order.id.slice(0, 8)}`;
    return { redirectUrl: `/paiement-test?commande=${order.number}`, reference };
  }
  async verifyWebhook(): Promise<null> {
    return null;
  }
}
