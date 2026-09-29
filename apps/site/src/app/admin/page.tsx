import { dashboard, PRESS_IMPRESSIONS_PER_MIN, type Stage, type Todo } from "@/lib/admin.ts";
import { formatEuros } from "@/lib/pricing.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atelier · Carte Blanche" };

const STATUS: Record<string, string> = {
  draft: "Panier", awaiting_payment: "Paiement en attente", paid: "Payée", in_production: "En production", printed: "Imprimée",
  shipped: "Expédiée", cancelled: "Annulée", uploaded: "Reçu", checking: "Contrôle", rejected: "À corriger", approved: "Validé",
  preparing: "Préparation", prepared: "Prêt", batched: "En lot", failed: "Erreur", generating: "Génération", generated: "À imprimer",
  dispatched: "Envoyé presse", planned: "Prévu",
};
const TODO_LABEL: Record<Todo["kind"], [string, string]> = {
  print: ["Presse", "print"], failed: ["Erreur", "err"], ship: ["Expédition", "ship"], urgent: ["Urgent", "err"], fix: ["Client", "warn"],
};
const MEDIA: Record<string, string> = { "cmdm-350g": "Couché mat 350 g", "carte-graphique-300g": "Carte graphique 300 g" };

function ago(d: Date | null) {
  if (!d) return "—";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} j`;
}
function delta(now: number, before: number) {
  if (!before) return now ? "nouveau" : "—";
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? "+" : ""}${p} % vs 30 j précédents`;
}

function RevenueChart({ data }: { data: { day: string; cents: number; orders: number }[] }) {
  const W = 1100, H = 190, pad = 64, max = Math.max(1, ...data.map((d) => d.cents));
  const bw = (W - pad) / data.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label="Chiffre d'affaires encaissé par jour, 30 derniers jours">
      {ticks.map((t) => {
        const y = H - (t / max) * (H - 10);
        return <g key={t}><line x1={pad} x2={W} y1={y} y2={y} className="grid" /><text x={pad - 8} y={y + 4} className="axis" textAnchor="end">{formatEuros(t).replace(/,00/, "")}</text></g>;
      })}
      {data.map((d, i) => {
        const h = (d.cents / max) * (H - 10), x = pad + i * bw + 1;
        const date = new Date(d.day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
        return (
          <g key={d.day} className="bar">
            <rect x={x - 1} y={0} width={bw} height={H} className="hit"><title>{`${date} · ${formatEuros(d.cents)} · ${d.orders} commande${d.orders > 1 ? "s" : ""}`}</title></rect>
            {d.cents > 0 && <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 10} q4,0 4,4 v${h - 4} z`} className="mark" />}
            {i % 7 === 0 && <text x={x + bw / 2 - 1} y={H + 16} className="axis" textAnchor="middle">{date}</text>}
          </g>
        );
      })}
      <line x1={pad} x2={W} y1={H} y2={H} className="base" />
    </svg>
  );
}

function Flow({ stages }: { stages: Stage[] }) {
  return (
    <div className="flow">
      {stages.map((s) => (
        <div key={s.key} className={`stage-box ${s.count ? s.tone : "idle"}`}>
          <span className="lbl">{s.label}</span>
          <b>{s.count}</b>
          <span className="sub">{s.hint}</span>
          <span className="age">{s.count ? `plus ancien : ${ago(s.oldest)}` : "rien en attente"}</span>
        </div>
      ))}
    </div>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const { lot } = await searchParams;
  const d = await dashboard();
  const { k } = d;
  const basket = k.orders30 ? Math.round(k.rev30 / k.orders30) : 0;
  const rejectRate = k.checked30 ? Math.round((k.rejected30 / k.checked30) * 100) : 0;
  const ORDER: Todo["kind"][] = ["urgent", "failed", "print", "ship", "fix"];
  const todo = [...d.todo].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  // Au-delà de 4 actions du même type, on résume (le détail est dans « Commandes »).
  const shown = ORDER.flatMap((kind) => todo.filter((t) => t.kind === kind).slice(0, 4));
  const hidden = ORDER.map((kind) => [kind, todo.filter((t) => t.kind === kind).length - 4] as const).filter(([, n]) => n > 0);

  return (
    <>
      <main className="bo-main">
        <header className="bo-head" id="pilotage">
          <div><h1>Pilotage</h1><p className="muted">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · 30 derniers jours</p></div>
          <form method="post" action="/api/admin/batch-request">
            <button className="btn red" type="submit" disabled={d.prepared === 0}>Lancer un lot SRA3 ({d.prepared} prêt{d.prepared > 1 ? "s" : ""})</button>
          </form>
        </header>
        {lot === "demande" && <p className="msg ok"><b>Lot demandé.</b> Le fichier SRA3 apparaît dans « À faire » d&apos;ici quelques secondes : rechargez la page.</p>}

        <section className="tiles">
          <div className="tile"><span>Chiffre d&apos;affaires</span><b>{formatEuros(k.rev30)}</b><small>{delta(k.rev30, k.revPrev)}</small></div>
          <div className="tile"><span>Commandes payées</span><b>{k.orders30}</b><small>{delta(k.orders30, k.ordersPrev)}</small></div>
          <div className="tile"><span>Panier moyen</span><b>{formatEuros(basket)}</b><small>{k.games30} jeux vendus</small></div>
          <div className="tile"><span>Délai paiement → lot</span><b>{k.leadHours == null ? "—" : `${Math.round(k.leadHours)} h`}</b><small>moyenne des lots du mois</small></div>
          <div className="tile"><span>Fichiers refusés</span><b>{rejectRate} %</b><small>{k.rejected30} sur {k.checked30} contrôlés</small></div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Chiffre d&apos;affaires encaissé par jour</h2><span className="muted">en euros TTC</span></div>
          <RevenueChart data={d.revenue} />
        </section>

        <section className="card" id="a-faire">
          <div className="card-head"><h2>À faire</h2><span className="muted">{todo.length ? `${todo.length} action${todo.length > 1 ? "s" : ""}` : "Tout est à jour"}</span></div>
          {todo.length === 0 && <p className="empty">Rien d&apos;urgent : les commandes avancent seules jusqu&apos;aux lots SRA3.</p>}
          <ul className="todo">
            {shown.map((t) => (
              <li key={`${t.kind}-${t.id}`}>
                <span className={`pill ${TODO_LABEL[t.kind][1]}`}>{TODO_LABEL[t.kind][0]}</span>
                <div><b>{t.number ? <a href={`/admin/commandes/${t.number}`}>{t.title}</a> : t.kind === "print" ? <a href={`/admin/lots/${t.id}`}>{t.title}</a> : t.title}</b><span className="muted">{t.detail}</span></div>
                <span className="muted when">{ago(t.since)}</span>
                <div className="acts">
                  {t.href && <a className="btn ghost small" href={t.href}>PDF</a>}
                  {t.kind === "ship" ? <a className="btn small" href={`/admin/commandes/${t.number}#expedition`}>Expédier →</a> : t.action && (
                    <form method="post" action="/api/admin/actions">
                      <input type="hidden" name="action" value={t.action} /><input type="hidden" name="id" value={t.id} />
                      <button className="btn small" type="submit">{{ batch_printed: "Imprimé ✓", order_shipped: "Expédiée ✓", retry_item: "Relancer" }[t.action]}</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hidden.map(([kind, n]) => <p key={kind} className="muted small">+ {n} autre{n > 1 ? "s" : ""} « {TODO_LABEL[kind][0].toLowerCase()} » : voir <a className="link" href="#commandes">Commandes</a></p>)}
        </section>

        <section className="card" id="production">
          <div className="card-head"><h2>Flux de production</h2><span className="muted">nombre de jeux à chaque étape</span></div>
          <Flow stages={d.stages} />
          {(d.alerts.failed > 0 || d.alerts.fix > 0) && (
            <p className="muted small">Hors flux : {d.alerts.fix} fichier{d.alerts.fix > 1 ? "s" : ""} à corriger par le client · {d.alerts.failed} erreur{d.alerts.failed > 1 ? "s" : ""} moteur.</p>
          )}
        </section>

        <section className="card" id="presse">
          <div className="card-head"><h2>Presse · Iridesse</h2><span className="muted">lots générés, pas encore imprimés</span></div>
          <div className="press">
            {d.press.length === 0 && <p className="empty">Aucune feuille en attente de presse.</p>}
            {d.press.map((p) => (
              <div key={p.media} className="press-row">
                <b>{MEDIA[p.media] ?? p.media}</b>
                <span><strong>{p.sheets}</strong> feuilles SRA3</span>
                <span><strong>{p.batches}</strong> lot{p.batches > 1 ? "s" : ""}</span>
                <span>≈ <strong>{Math.max(1, Math.round(p.impressions / PRESS_IMPRESSIONS_PER_MIN))}</strong> min de presse</span>
              </div>
            ))}
            {d.waiting.length > 0 && (
              <p className="muted small">En préparation : {d.waiting.map((w) => `${w.games} jeu${w.games > 1 ? "x" : ""} sur ${MEDIA[w.media] ?? w.media}`).join(" · ")}</p>
            )}
          </div>
        </section>

        <section className="card" id="commandes">
          <div className="card-head"><h2>Commandes</h2><span className="muted">30 dernières</span></div>
          <div className="scroll"><table>
            <thead><tr><th>N°</th><th>Client</th><th>Contenu</th><th>Total</th><th>État</th><th>Payée</th><th>Échéance</th></tr></thead>
            <tbody>{d.orders.map((o) => (
              <tr key={o.number}><td><a className="link" href={`/admin/commandes/${o.number}`}><b>{o.number}</b></a></td><td>{o.email}</td>
                <td>{o.items.map((i, n) => <div key={n}>{i.copies} × {i.product}{i.design ? " · en ligne" : " · PDF"} <span className={`status ${i.status}`}>{STATUS[i.status] ?? i.status}</span></div>)}</td>
                <td className="num">{formatEuros(o.total_cents)}</td><td><span className={`status ${o.status}`}>{STATUS[o.status] ?? o.status}</span></td>
                <td>{o.paid_at ? new Date(o.paid_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td>{o.due_date ?? "—"}</td></tr>
            ))}{!d.orders.length && <tr><td colSpan={7} className="muted">Aucune commande pour l&apos;instant.</td></tr>}</tbody>
          </table></div>
        </section>

        <section className="card" id="lots">
          <div className="card-head"><h2>Lots SRA3</h2><span className="muted">20 derniers</span></div>
          <div className="scroll"><table>
            <thead><tr><th>Lot</th><th>Support</th><th>Commandes</th><th>Feuilles</th><th>Remplissage</th><th>État</th><th>Fichiers</th></tr></thead>
            <tbody>{d.batches.map((b) => (
              <tr key={b.id}><td><a className="link" href={`/admin/lots/${b.id}`}><b>{b.id}</b></a></td><td>{MEDIA[b.media] ?? b.media}</td><td>{b.orders.length ? b.orders.map((n, i) => <span key={n}>{i ? ", " : ""}<a href={`/admin/commandes/${n}`}>{n}</a></span>) : "—"}</td>
                <td className="num">{b.sheets ?? "—"} <span className="muted">({b.impressions ?? "—"} faces)</span></td>
                <td>{b.fill_ratio ? <div className="fill"><i style={{ width: `${Math.round(Number(b.fill_ratio) * 100)}%` }} /><span>{Math.round(Number(b.fill_ratio) * 100)} %</span></div> : "—"}</td>
                <td><span className={`status ${b.status}`}>{STATUS[b.status] ?? b.status}</span></td>
                <td>{b.pdf_path && <><a className="link" href={`/api/admin/files/production/${b.pdf_path}`}>PDF</a>{" · "}
                  <a className="link" href={`/api/admin/files/production/${b.pdf_path.replace(/\.pdf$/, ".json")}`}>Manifeste</a></>}</td></tr>
            ))}{!d.batches.length && <tr><td colSpan={7} className="muted">Aucun lot pour l&apos;instant.</td></tr>}</tbody>
          </table></div>
        </section>
      </main>
    </>
  );
}
