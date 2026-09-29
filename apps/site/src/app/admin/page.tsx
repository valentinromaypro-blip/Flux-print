import { sql } from "@/lib/db.ts";
import { formatEuros } from "@/lib/pricing.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atelier · Carte Blanche" };

type OrderRow = { number: string; email: string | null; status: string; total_cents: number; created_at: Date; items: { product: string; status: string; copies: number }[] };
type BatchRow = { id: string; media: string; status: string; sheets: number | null; impressions: number | null; fill_ratio: string | null; pdf_path: string | null; created_at: Date; items: number };

export default async function Admin({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const { lot } = await searchParams;
  const db = sql();
  const orders = await db<OrderRow[]>`
    select o.number, o.email, o.status, o.total_cents, o.created_at,
           coalesce(json_agg(json_build_object('product', i.product_code, 'status', i.status, 'copies', i.copies))
                    filter (where i.id is not null), '[]') as items
      from public.orders o left join public.order_items i on i.order_id = o.id
     where o.status <> 'draft' group by o.id order by o.created_at desc limit 50`;
  const batches = await db<BatchRow[]>`
    select b.*, (select count(*)::int from public.order_items i where i.batch_id = b.id) as items
      from public.batches b order by b.created_at desc limit 30`;
  const [k] = await db<{ paid: number; waiting: number; prepared: number; revenue: number }[]>`
    select count(*) filter (where status in ('paid', 'in_production'))::int as paid,
           count(*) filter (where status = 'awaiting_payment')::int as waiting,
           (select count(*)::int from public.order_items where status = 'prepared') as prepared,
           coalesce(sum(total_cents) filter (where status in ('paid', 'in_production', 'printed', 'shipped')), 0)::int as revenue
      from public.orders`;
  return (
    <div className="container admin" style={{ paddingBottom: 80 }}>
      <h1 className="page-title">Atelier</h1>
      <div className="kpis">
        <div><span className="muted">Commandes à produire</span><b>{k.paid}</b></div>
        <div><span className="muted">Paiements en attente</span><b>{k.waiting}</b></div>
        <div><span className="muted">Jeux prêts à amalgamer</span><b>{k.prepared}</b></div>
        <div><span className="muted">Chiffre d&apos;affaires encaissé</span><b>{formatEuros(k.revenue)}</b></div>
      </div>
      <div className="head" style={{ marginTop: 36, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Lots SRA3</h2>
        <form method="post" action="/api/admin/batch-request">
          <button className="btn red" type="submit" disabled={k.prepared === 0}>Lancer un lot maintenant ({k.prepared} jeu{k.prepared > 1 ? "x" : ""} prêt{k.prepared > 1 ? "s" : ""})</button>
        </form>
      </div>
      {lot === "demande" && <p className="msg ok" style={{ marginBottom: 14 }}><b>Lot demandé.</b> Le fichier SRA3 apparaît ici dans quelques secondes : rechargez la page.</p>}
      <div className="scroll"><table>
        <thead><tr><th>Lot</th><th>Support</th><th>Lignes</th><th>Feuilles</th><th>Remplissage</th><th>État</th><th>Fichiers</th></tr></thead>
        <tbody>{batches.map((b) => (
          <tr key={b.id}><td>{b.id}</td><td>{b.media}</td><td>{b.items}</td><td>{b.sheets ?? "—"} ({b.impressions ?? "—"} faces)</td>
            <td>{b.fill_ratio ? `${Math.round(Number(b.fill_ratio) * 100)} %` : "—"}</td><td><span className={`status ${b.status}`}>{b.status}</span></td>
            <td>{b.pdf_path && <><a className="link" href={`/api/admin/files/production/${b.pdf_path}`}>PDF SRA3</a>{" "}
              <a className="link" href={`/api/admin/files/production/${b.pdf_path.replace(/\.pdf$/, ".json")}`}>Manifeste</a></>}</td></tr>
        ))}{!batches.length && <tr><td colSpan={7} className="muted">Aucun lot pour l&apos;instant.</td></tr>}</tbody>
      </table></div>
      <h2>Commandes</h2>
      <div className="scroll"><table>
        <thead><tr><th>N°</th><th>Client</th><th>Jeux</th><th>Total</th><th>État</th><th>Date</th></tr></thead>
        <tbody>{orders.map((o) => (
          <tr key={o.number}><td>{o.number}</td><td>{o.email}</td>
            <td>{o.items.map((i, n) => <div key={n}>{i.copies} × {i.product} <span className={`status ${i.status}`}>{i.status}</span></div>)}</td>
            <td>{formatEuros(o.total_cents)}</td><td><span className={`status ${o.status}`}>{o.status}</span></td>
            <td>{new Date(o.created_at).toLocaleString("fr-FR")}</td></tr>
        ))}{!orders.length && <tr><td colSpan={6} className="muted">Aucune commande pour l&apos;instant.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}
