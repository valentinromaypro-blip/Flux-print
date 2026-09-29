import { notFound } from "next/navigation";
import PrintButton from "@/components/PrintButton";
import { sql } from "@/lib/db.ts";
import { formatEuros } from "@/lib/pricing.ts";

export const dynamic = "force-dynamic";

type Order = {
  id: string; number: string; email: string; status: string; total_cents: number; created_at: Date; paid_at: Date | null;
  due_date: string | null; payment_ref: string | null; shipping_address: Record<string, string> | null;
  carrier: string | null; tracking_number: string | null; shipped_at: Date | null;
};
type Item = {
  id: string; product_code: string; label: string | null; media: string; copies: number; status: string; options: Record<string, unknown>;
  source_path: string | null; prepared_path: string | null; preview_paths: string[]; design: unknown; error: string | null;
  batch_id: string | null; batch_status: string | null; batch_pdf: string | null; manifest: Manifest | null;
};
type Manifest = { items?: Record<string, string>; sheets?: { sheet: number; slots: { job: string; kind: string }[] }[]; stacking_instructions?: string };
type Event = { entity: string; type: string; created_at: Date; payload: Record<string, unknown> };

const STATUS: Record<string, string> = {
  awaiting_payment: "Paiement en attente", paid: "Payée", in_production: "En production", printed: "Imprimée", shipped: "Expédiée",
  cancelled: "Annulée", draft: "Panier", uploaded: "Reçu", checking: "Contrôle", rejected: "À corriger", approved: "Validé",
  preparing: "Préparation", prepared: "Prêt à amalgamer", batched: "En lot", failed: "Erreur", generated: "À imprimer", printed_batch: "Imprimé",
};
const EVENTS: Record<string, string> = {
  designed: "Création en ligne enregistrée", paid: "Paiement reçu", approved: "Fichier validé au contrôle", rejected: "Fichier refusé au contrôle", prepared: "Préparé pour l'impression (CMJN)",
  failed: "Erreur du moteur", retried: "Relancé depuis l'atelier", generated: "Lot SRA3 généré", printed: "Lot imprimé", shipped: "Expédiée",
};
const MEDIA: Record<string, string> = { "cmdm-350g": "Couché mat 350 g", "carte-graphique-300g": "Carte graphique 300 g" };
const COUNTRY: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", LU: "Luxembourg" };
const file = (bucket: string, path: string) => `/api/admin/files/${bucket}/${path}`;
const when = (d: Date | null) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Feuilles du lot où se trouve la ligne (pour la retrouver dans la pile après la coupe). */
function sheetsOf(item: Item) {
  const m = item.manifest;
  const job = Object.entries(m?.items ?? {}).find(([, id]) => id === item.id)?.[0];
  if (!m?.sheets || !job) return null;
  const nums = m.sheets.filter((s) => s.slots.some((sl) => sl.job === job)).map((s) => s.sheet);
  return nums.length ? { job, first: Math.min(...nums), last: Math.max(...nums) } : null;
}

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const db = sql();
  const [order] = await db<Order[]>`select * from public.orders where number = ${number}`;
  if (!order) notFound();
  const items = await db<Item[]>`
    select i.*, p.label, b.status as batch_status, b.pdf_path as batch_pdf, b.manifest
      from public.order_items i left join public.products p on p.code = i.product_code left join public.batches b on b.id = i.batch_id
     where i.order_id = ${order.id} order by i.created_at`;
  const events = await db<Event[]>`
    select entity, type, created_at, payload from public.events
     where (entity = 'order' and entity_id = ${order.id})
        or (entity = 'item' and entity_id in ${db(items.map((i) => i.id).concat(["-"]))})
        or (entity = 'batch' and entity_id in ${db(items.map((i) => i.batch_id ?? "-").concat(["-"]))})
     order by created_at`;
  const a = order.shipping_address ?? {};
  const games = items.reduce((n, i) => n + i.copies, 0);

  return (
    <main className="bo-main order-page">
      <header className="bo-head">
        <div>
          <p className="muted"><a className="link" href="/admin#commandes">← Commandes</a></p>
          <h1>{order.number} <span className={`status ${order.status}`}>{STATUS[order.status] ?? order.status}</span></h1>
          <p className="muted">Passée le {when(order.created_at)} · payée le {when(order.paid_at)}{order.due_date ? ` · à expédier avant le ${new Date(order.due_date).toLocaleDateString("fr-FR")}` : ""}</p>
        </div>
        <div className="row-actions no-print">
          <PrintButton label="Imprimer le bon de livraison" />
        </div>
      </header>

      <div className="order-grid">
        <section className="card" id="expedition">
          <div className="card-head"><h2>Livraison</h2><span className="muted">{games} jeu{games > 1 ? "x" : ""}</span></div>
          <address className="addr">
            <b>{a.name ?? "—"}</b>
            {a.line1 && <span>{a.line1}</span>}{a.line2 && <span>{a.line2}</span>}
            <span>{[a.postal_code, a.city].filter(Boolean).join(" ")}</span>
            <span>{COUNTRY[a.country ?? ""] ?? a.country ?? ""}</span>
          </address>
          <p className="muted small">{order.email}</p>
          {order.status === "shipped" ? (
            <p className="msg ok"><b>Expédiée le {when(order.shipped_at)}</b>{order.carrier || order.tracking_number ? <span>{order.carrier} · suivi {order.tracking_number}</span> : null}</p>
          ) : (
            <form method="post" action="/api/admin/actions" className="ship no-print">
              <input type="hidden" name="action" value="order_shipped" /><input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="back" value={`/admin/commandes/${order.number}`} />
              <div className="grid2">
                <label className="field">Transporteur<select name="carrier" defaultValue="Colissimo"><option>Colissimo</option><option>Mondial Relay</option><option>Chronopost</option><option>Lettre suivie</option><option>Retrait atelier</option></select></label>
                <label className="field">N° de suivi<input name="tracking" placeholder="facultatif" /></label>
              </div>
              <button className="btn red" type="submit" disabled={order.status !== "printed"}>
                {order.status === "printed" ? "Marquer expédiée" : "Expédition possible une fois imprimée"}
              </button>
            </form>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Paiement</h2></div>
          <div className="kv"><span>Total TTC</span><b>{formatEuros(order.total_cents)}</b></div>
          <div className="kv"><span>Référence</span><span className="mono">{order.payment_ref ?? "—"}</span></div>
          <div className="kv"><span>Client</span><span>{order.email}</span></div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Contenu et fichiers d&apos;impression</h2></div>
        {items.map((i) => {
          const where = sheetsOf(i);
          return (
            <article key={i.id} className="item">
              <div className="thumbs-row">{i.preview_paths.map((p) => <img key={p} src={file("previews", p)} alt="" />)}{!i.preview_paths.length && <div className="ph" />}</div>
              <div className="item-body">
                <h3>{i.copies} × {i.label ?? i.product_code} <span className={`status ${i.status}`}>{STATUS[i.status] ?? i.status}</span></h3>
                <p className="muted small">{MEDIA[i.media] ?? i.media} · {i.design ? "créé en ligne" : "PDF déposé par le client"}{Object.keys(i.options ?? {}).length ? ` · ${Object.entries(i.options).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}</p>
                {i.error && <p className="error-text">{i.error}</p>}
                <div className="files">
                  {i.source_path && <a className="file" href={file("uploads", i.source_path)}><b>Fichier client</b><span>{i.design ? "rendu de la création en ligne" : "tel que déposé"}</span></a>}
                  {i.prepared_path && <a className="file" href={file("production", i.prepared_path)}><b>PDF d&apos;impression</b><span>converti CMJN FOGRA51 · fonds perdus 3 mm</span></a>}
                  {i.batch_pdf && <a className="file main" href={file("production", i.batch_pdf)}><b>Lot SRA3 {i.batch_id}</b><span>PDF/X-4 imposé · {where ? `feuilles ${where.first} à ${where.last} · repère ${where.job}` : "prêt pour le Fiery"}</span></a>}
                  {!i.prepared_path && !i.batch_pdf && <span className="muted small">Le PDF d&apos;impression est créé après le paiement, puis placé dans un lot SRA3.</span>}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="card no-print">
        <div className="card-head"><h2>Historique</h2></div>
        <ol className="timeline-v">
          {events.map((e, n) => <li key={n}><span className="muted">{when(e.created_at)}</span><span>{EVENTS[e.type] ?? e.type}{e.entity === "batch" ? " (lot)" : ""}</span></li>)}
          {!events.length && <li className="muted">Aucun événement.</li>}
        </ol>
      </section>

      {/* Bon de livraison : seule partie imprimée */}
      <section className="packing-slip">
        <div className="slip-head"><b>Carte Blanche</b><span>Bon de livraison · {order.number}</span></div>
        <div className="slip-addr"><b>{a.name}</b><span>{a.line1}</span>{a.line2 && <span>{a.line2}</span>}<span>{a.postal_code} {a.city}</span><span>{COUNTRY[a.country ?? ""] ?? a.country}</span></div>
        <table><thead><tr><th>Article</th><th>Carton</th><th>Qté</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.id}><td>{i.label ?? i.product_code}</td><td>{MEDIA[i.media] ?? i.media}</td><td>{i.copies}</td></tr>)}</tbody></table>
        <p>Merci pour votre commande ! Imprimé et façonné dans notre atelier en France.</p>
      </section>
    </main>
  );
}
