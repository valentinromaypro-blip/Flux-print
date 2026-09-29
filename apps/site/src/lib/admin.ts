// Données du tableau de bord de l'atelier (pilotage). Tout est lu en direct dans la base.
import { sql } from "@/lib/db.ts";

/** Cadence de la presse en faces SRA3 par minute (Iridesse, recto verso). À ajuster selon vos relevés. */
export const PRESS_IMPRESSIONS_PER_MIN = 60;

export type Stage = { key: string; label: string; hint: string; count: number; oldest: Date | null; tone: "ok" | "warn" | "err" | "idle" };
export type Todo = { kind: "print" | "failed" | "ship" | "urgent" | "fix"; title: string; detail: string; id: string; href?: string; action?: string; since: Date };
export type Batch = { id: string; media: string; status: string; sheets: number | null; impressions: number | null; fill_ratio: string | null; pdf_path: string | null; created_at: Date; items: number; orders: string[] };
export type OrderRow = { number: string; email: string | null; status: string; total_cents: number; created_at: Date; paid_at: Date | null; due_date: string | null; items: { product: string; status: string; copies: number; design: boolean }[] };

export async function dashboard() {
  const db = sql();
  const [k] = await db<{ rev30: number; revPrev: number; orders30: number; ordersPrev: number; games30: number; checked30: number; rejected30: number; leadHours: number | null; lastEvent: Date | null }[]>`
    select
      coalesce(sum(o.total_cents) filter (where o.paid_at >= now() - interval '30 days'), 0)::int as "rev30",
      coalesce(sum(o.total_cents) filter (where o.paid_at >= now() - interval '60 days' and o.paid_at < now() - interval '30 days'), 0)::int as "revPrev",
      count(*) filter (where o.paid_at >= now() - interval '30 days')::int as "orders30",
      count(*) filter (where o.paid_at >= now() - interval '60 days' and o.paid_at < now() - interval '30 days')::int as "ordersPrev",
      (select coalesce(sum(i.copies), 0)::int from public.order_items i join public.orders x on x.id = i.order_id
        where x.paid_at >= now() - interval '30 days') as "games30",
      (select count(*)::int from public.order_items where created_at >= now() - interval '30 days' and preflight_report is not null) as "checked30",
      (select count(*)::int from public.order_items where created_at >= now() - interval '30 days' and status = 'rejected') as "rejected30",
      (select extract(epoch from avg(b.generated_at - x.paid_at)) / 3600 from public.order_items i
         join public.batches b on b.id = i.batch_id join public.orders x on x.id = i.order_id
        where b.generated_at >= now() - interval '30 days') as "leadHours",
      (select max(created_at) from public.events) as "lastEvent"
    from public.orders o where o.paid_at is not null and o.status <> 'cancelled'`;

  const revenue = await db<{ day: string; cents: number; orders: number }[]>`
    select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(o.total_cents), 0)::int as cents, count(o.id)::int as orders
      from generate_series(current_date - 29, current_date, interval '1 day') d
      left join public.orders o on o.paid_at::date = d::date and o.status <> 'cancelled'
     group by d order by d`;

  // Flux de production : où en sont les jeux, et depuis quand le plus ancien attend.
  const rows = await db<{ stage: string; count: number; oldest: Date | null }[]>`
    select stage, count(*)::int as count, min(since) as oldest from (
      select case
        when i.status = 'failed' then 'failed'
        when i.status in ('uploaded', 'checking') then 'checking'
        when i.status = 'rejected' then 'fix'
        when o.status in ('draft', 'awaiting_payment') then 'cart'
        when i.status in ('approved', 'preparing') then 'prep'
        when i.status = 'prepared' then 'ready'
        when i.status = 'batched' and o.status = 'printed' then 'printed'
        when i.status = 'batched' and o.status = 'shipped' then 'shipped'
        when i.status = 'batched' then 'press'
      end as stage, i.updated_at as since
      from public.order_items i join public.orders o on o.id = i.order_id
     where o.status <> 'cancelled' and (o.status <> 'shipped' or o.updated_at >= now() - interval '7 days')
    ) s where stage is not null group by stage`;
  const at = (key: string) => rows.find((r) => r.stage === key) ?? { count: 0, oldest: null };
  const stage = (key: string, label: string, hint: string, tone: Stage["tone"]): Stage => ({ key, label, hint, tone, ...at(key) });
  const stages: Stage[] = [
    stage("cart", "Paniers", "validés, non payés", "idle"),
    stage("checking", "Contrôle", "rendu et preflight", "idle"),
    stage("prep", "Préparation", "payés, conversion CMJN", "idle"),
    stage("ready", "À amalgamer", "attendent un lot SRA3", "warn"),
    stage("press", "À imprimer", "dans un lot généré", "warn"),
    stage("printed", "À expédier", "imprimés", "warn"),
    stage("shipped", "Expédiés", "7 derniers jours", "ok"),
  ];
  const alerts = { failed: at("failed").count, fix: at("fix").count };

  const batches = await db<Batch[]>`
    select b.id, b.media, b.status, b.sheets, b.impressions, b.fill_ratio, b.pdf_path, b.created_at,
           count(i.id)::int as items, coalesce(array_agg(distinct o.number) filter (where o.number is not null), '{}') as orders
      from public.batches b left join public.order_items i on i.batch_id = b.id left join public.orders o on o.id = i.order_id
     group by b.id order by b.created_at desc limit 20`;

  const press = await db<{ media: string; batches: number; sheets: number; impressions: number }[]>`
    select media, count(*)::int as batches, coalesce(sum(sheets), 0)::int as sheets, coalesce(sum(impressions), 0)::int as impressions
      from public.batches where status in ('generated', 'dispatched') group by media order by media`;
  const waiting = await db<{ media: string; games: number }[]>`
    select i.media, sum(i.copies)::int as games from public.order_items i where i.status in ('approved', 'preparing', 'prepared')
       and exists (select 1 from public.orders o where o.id = i.order_id and o.status in ('paid', 'in_production'))
     group by i.media order by i.media`;

  const todo: Todo[] = [];
  for (const b of batches.filter((b) => b.status === "generated" || b.status === "dispatched")) {
    todo.push({ kind: "print", id: b.id, since: b.created_at, action: "batch_printed",
      title: `Imprimer le lot ${b.id}`, detail: `${b.media} · ${b.sheets ?? "?"} feuilles SRA3 · ${b.orders.length} commande${b.orders.length > 1 ? "s" : ""}`,
      href: b.pdf_path ? `/api/admin/files/production/${b.pdf_path}` : undefined });
  }
  const failed = await db<{ id: string; number: string; product_code: string; error: string | null; updated_at: Date }[]>`
    select i.id, o.number, i.product_code, i.error, i.updated_at from public.order_items i join public.orders o on o.id = i.order_id
     where i.status = 'failed' order by i.updated_at limit 10`;
  for (const f of failed) {
    todo.push({ kind: "failed", id: f.id, since: f.updated_at, action: "retry_item",
      title: `Erreur moteur · ${f.number}`, detail: `${f.product_code} · ${(f.error ?? "").slice(0, 110)}` });
  }
  const toShip = await db<{ id: string; number: string; email: string; updated_at: Date }[]>`
    select id, number, email, updated_at from public.orders where status = 'printed' order by updated_at limit 10`;
  for (const o of toShip) {
    todo.push({ kind: "ship", id: o.id, since: o.updated_at, action: "order_shipped", title: `Expédier ${o.number}`, detail: o.email });
  }
  const urgent = await db<{ id: string; number: string; due_date: string; updated_at: Date }[]>`
    select id, number, to_char(due_date, 'DD/MM') as due_date, updated_at from public.orders
     where status in ('paid', 'in_production') and due_date is not null and due_date <= current_date + 2 order by due_date limit 10`;
  for (const o of urgent) {
    todo.push({ kind: "urgent", id: o.id, since: o.updated_at, title: `Urgent · ${o.number}`, detail: `À expédier au plus tard le ${o.due_date}` });
  }
  const fix = await db<{ id: string; number: string; email: string | null; updated_at: Date }[]>`
    select o.id, o.number, o.email, max(i.updated_at) as updated_at from public.order_items i join public.orders o on o.id = i.order_id
     where i.status = 'rejected' and i.updated_at < now() - interval '48 hours' and o.email is not null
     group by o.id order by 4 limit 10`;
  for (const o of fix) {
    todo.push({ kind: "fix", id: o.id, since: o.updated_at, title: `Relancer ${o.email}`, detail: `${o.number} · fichier à corriger depuis plus de 48 h` });
  }

  const orders = await db<OrderRow[]>`
    select o.number, o.email, o.status, o.total_cents, o.created_at, o.paid_at, to_char(o.due_date, 'DD/MM') as due_date,
           coalesce(json_agg(json_build_object('product', i.product_code, 'status', i.status, 'copies', i.copies, 'design', i.design is not null))
                    filter (where i.id is not null), '[]') as items
      from public.orders o left join public.order_items i on i.order_id = o.id
     where o.status <> 'draft' group by o.id order by o.created_at desc limit 30`;

  const [{ prepared }] = await db<{ prepared: number }[]>`select count(*)::int as prepared from public.order_items where status = 'prepared'`;

  return { k, revenue, stages, alerts, batches, press, waiting, todo, orders, prepared };
}
