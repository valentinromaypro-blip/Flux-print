import { sql } from "@/lib/db.ts";

// Actions de l'atelier depuis le tableau de bord (protégé par le proxy /api/admin).
//   batch_printed : le lot est sorti de presse → ses commandes complètes passent « imprimées »
//   order_shipped : la commande est partie
//   retry_item    : relancer une ligne en erreur moteur (contrôle ou préparation)
export async function POST(request: Request) {
  const form = await request.formData();
  const action = String(form.get("action") ?? ""), id = String(form.get("id") ?? "");
  const db = sql();
  if (action === "batch_printed") {
    await db.begin(async (tx) => {
      await tx`update public.batches set status = 'printed' where id = ${id} and status in ('generated', 'dispatched')`;
      await tx`update public.orders o set status = 'printed'
                where o.status = 'in_production'
                  and o.id in (select order_id from public.order_items where batch_id = ${id})
                  and not exists (select 1 from public.order_items i left join public.batches b on b.id = i.batch_id
                                   where i.order_id = o.id and (b.status is distinct from 'printed'))`;
      await tx`insert into public.events (entity, entity_id, type, payload) values ('batch', ${id}, 'printed', '{}')`;
    });
  } else if (action === "order_shipped") {
    const carrier = String(form.get("carrier") ?? "").slice(0, 40) || null, tracking = String(form.get("tracking") ?? "").trim().slice(0, 60) || null;
    await db`update public.orders set status = 'shipped', shipped_at = now(), carrier = ${carrier}, tracking_number = ${tracking}
              where id = ${id} and status = 'printed'`;
    await db`insert into public.events (entity, entity_id, type, payload) values ('order', ${id}, 'shipped', ${db.json({ carrier, tracking })})`;
  } else if (action === "retry_item") {
    await db`update public.order_items
                set status = case when error like 'prepare:%' then 'approved' else 'uploaded' end, error = null
              where id = ${id} and status = 'failed'`;
    await db`insert into public.events (entity, entity_id, type, payload) values ('item', ${id}, 'retried', '{}')`;
  } else {
    return new Response("Action inconnue.", { status: 400 });
  }
  const back = String(form.get("back") ?? "");
  return Response.redirect(new URL(back.startsWith("/admin") ? back : "/admin#a-faire", request.url), 303);
}
