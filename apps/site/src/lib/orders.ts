import { sql } from "./db.ts";
import type { OrderItem } from "./types.ts";

export type Order = {
  id: string;
  number: string;
  email: string | null;
  status: string;
  total_cents: number;
  session_token: string | null;
  payment_provider: string | null;
  payment_ref: string | null;
  shipping_address: Record<string, string> | null;
  created_at: string;
  paid_at: string | null;
};

export async function draftOrder(session: string, create: boolean): Promise<Order | null> {
  const db = sql();
  const [found] = await db<Order[]>`
    select * from public.orders where session_token = ${session} and status = 'draft'
     order by created_at desc limit 1`;
  if (found || !create) return found ?? null;
  const [order] = await db<Order[]>`insert into public.orders (session_token) values (${session}) returning *`;
  return order;
}

export async function orderItems(orderId: string): Promise<OrderItem[]> {
  return sql()<OrderItem[]>`select * from public.order_items where order_id = ${orderId} order by created_at`;
}

/** Ligne appartenant à la session (panier en cours ou commande passée). */
export async function sessionItem(session: string, itemId: string): Promise<OrderItem | null> {
  if (!/^[0-9a-f-]{36}$/.test(itemId)) return null;
  const [row] = await sql()<OrderItem[]>`
    select i.* from public.order_items i join public.orders o on o.id = i.order_id
     where i.id = ${itemId} and o.session_token = ${session}`;
  return row ?? null;
}

export async function orderByNumber(session: string, number: string): Promise<Order | null> {
  const [row] = await sql()<Order[]>`
    select * from public.orders where number = ${number} and session_token = ${session}`;
  return row ?? null;
}

export async function logEvent(entity: "order" | "item" | "batch", id: string, type: string, payload: object = {}) {
  await sql()`insert into public.events (entity, entity_id, type, payload) values (${entity}, ${id}, ${type}, ${sql().json(payload as never)})`;
}

/**
 * Passe une commande à « payée » si le montant encaissé correspond. Idempotent :
 * un webhook reçu deux fois ne fait rien la seconde fois.
 */
export async function markPaid(orderId: string, provider: string, paymentRef: string, amountCents: number): Promise<boolean> {
  const db = sql();
  const rows = await db`
    update public.orders set status = 'paid', paid_at = now(), payment_ref = ${paymentRef}
     where id = ${orderId} and status in ('awaiting_payment', 'draft') and payment_provider = ${provider}
       and total_cents = ${amountCents}
    returning id`;
  if (rows.length) await logEvent("order", orderId, "paid", { provider, paymentRef, amountCents });
  else await logEvent("order", orderId, "payment_not_applied", { provider, paymentRef, amountCents });
  return rows.length > 0;
}
