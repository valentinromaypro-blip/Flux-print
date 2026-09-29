import { notFound } from "next/navigation";
import { presentOrder } from "@/lib/cart.ts";
import { orderByNumber } from "@/lib/orders.ts";
import { formatEuros } from "@/lib/pricing.ts";
import { readSession } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

const STEPS = [
  { label: "Commande payée", done: ["paid", "in_production", "printed", "shipped"] },
  { label: "Fichiers préparés pour l'impression", done: ["in_production", "printed", "shipped"] },
  { label: "Imprimée à l'atelier", done: ["printed", "shipped"] },
  { label: "Expédiée", done: ["shipped"] },
];

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const session = await readSession();
  const order = session ? await orderByNumber(session, (await params).number) : null;
  if (!order) notFound();
  const view = await presentOrder(order);
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <h1 className="page-title">Commande {order.number}</h1>
      <p className="muted">{order.status === "awaiting_payment" ? "En attente de la confirmation du paiement." : `Merci ! Un e-mail de confirmation est envoyé à ${order.email}.`}</p>
      <div className="timeline">{STEPS.map((s) => <div key={s.label} className={s.done.includes(order.status) ? "done" : ""}>{s.label}</div>)}</div>
      {view.items.map((item) => (
        <div className="line" key={item.id}>
          {item.previews[1] || item.previews[0] ? <img src={item.previews[1] ?? item.previews[0]} alt="" /> : <div className="ph" />}
          <div style={{ display: "grid", gap: 6 }}><h3>{item.title}</h3><div className="details">{item.details.join(" · ")} · {item.copies} ex.</div></div>
          <div className="amount">{item.totalCents != null ? formatEuros(item.totalCents) : "—"}</div>
        </div>
      ))}
      <p style={{ marginTop: 20, fontWeight: 600 }}>Total payé : {formatEuros(order.total_cents)}</p>
    </div>
  );
}
