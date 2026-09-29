import { notFound } from "next/navigation";
import PrintButton from "@/components/PrintButton";
import { sql } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

type Stack = { book?: number; stack: number; job?: string; count: number; first: string; last: string; cards?: number };
type Manifest = {
  sheet: { width_mm: number; height_mm: number; flip: string }; order: string; sheets_count: number; impressions: number;
  book_sheets: number | null; fill_ratio: number; layout: { description: string; per_sheet: number };
  slots: { slot: number; trim_mm: [number, number, number, number] }[]; stacks: Stack[]; stacking_instructions: string;
  items?: Record<string, string>; reason?: string; books?: { book: number; sheets: number; first_sheet: number }[];
  decks?: { job: string; copy: number; book: number; stacks: number[]; cards: number }[];
};
const MEDIA: Record<string, string> = { "cmdm-350g": "Couché mat 350 g", "carte-graphique-300g": "Carte graphique 300 g" };
const MM = 72 / 25.4;

/** Plan de la feuille SRA3 (vue du recto), une case par pose, à l'échelle réelle. */
function SheetMap({ m, stacks, label }: { m: Manifest; stacks: Stack[]; label: (s: Stack) => [string, string] }) {
  const W = m.sheet.width_mm, H = m.sheet.height_mm;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sheet-map" role="img" aria-label="Plan des poses sur la feuille">
      <rect x={0} y={0} width={W} height={H} className="paper" />
      {m.slots.map((s) => {
        // trim_mm = [x0, y0, x1, y1] en mm depuis le bas-gauche (repère PDF) : on retourne l'axe y
        const [x0, y0, x1, y1] = s.trim_mm, st = stacks.find((k) => k.stack === s.slot);
        const [a, b] = st ? label(st) : ["vide", ""];
        const cx = (x0 + x1) / 2, cy = H - (y0 + y1) / 2;
        return (
          <g key={s.slot} className={st ? "pose" : "pose empty"}>
            <rect x={x0} y={H - y1} width={x1 - x0} height={y1 - y0} rx={2} />
            <text x={x0 + 3} y={H - y1 + 7} className="n">{s.slot}</text>
            <text x={cx} y={cy - 1} textAnchor="middle" className="a">{a}</text>
            <text x={cx} y={cy + 8} textAnchor="middle" className="b">{b}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = sql();
  const [batch] = await db<{ id: string; media: string; status: string; pdf_path: string | null; manifest: Manifest | null; created_at: Date }[]>`
    select id, media, status, pdf_path, manifest, created_at from public.batches where id = ${id}`;
  if (!batch?.manifest) notFound();
  const m = batch.manifest;
  const itemIds = Object.values(m.items ?? {});
  const rows = await db<{ id: string; number: string; copies: number }[]>`
    select i.id, o.number, i.copies from public.order_items i join public.orders o on o.id = i.order_id
     where i.id in ${db(itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"])}`;
  const orderOf = (job?: string) => {
    const item = rows.find((r) => r.id === (m.items ?? {})[job ?? ""]);
    return item ? { number: item.number, copies: item.copies } : null;
  };
  const lanes = m.order === "lanes";
  const deck = m.order === "deck_stack" || lanes;
  const books = deck ? [...new Set(m.stacks.map((s) => s.book ?? 1))] : [1];
  // Numéro d'exemplaire pour les commandes de plusieurs jeux (jeu 2/3)
  const copyIndex = new Map<string, number>();
  const labelDeck = (s: Stack): [string, string] => {
    const o = orderOf(s.job);
    if (lanes) {
      const d = m.decks?.find((x) => x.book === (s.book ?? 1) && x.stacks.includes(s.stack));
      if (d) {
        const copy = o && o.copies > 1 ? `jeu ${d.copy}/${o.copies}` : `${d.cards} cartes`;
        return [o?.number ?? d.job, d.stacks.length > 1 ? `${copy} · ${d.stacks.indexOf(s.stack) + 1}/${d.stacks.length}` : copy];
      }
    }
    const n = (copyIndex.get(`${s.book}-${s.stack}`) ?? 0);
    return [o?.number ?? s.job ?? "?", o && o.copies > 1 ? `jeu ${n}/${o.copies}` : `${s.cards ?? s.count} cartes`];
  };
  if (deck) {
    const seen = new Map<string, number>();
    for (const s of m.stacks) { const k = s.job ?? ""; seen.set(k, (seen.get(k) ?? 0) + 1); copyIndex.set(`${s.book}-${s.stack}`, seen.get(k)!); }
  }
  const labelCompact = (s: Stack): [string, string] => [`pile ${s.stack}`, `${s.first.split(" · ")[1]} → ${s.last.split(" · ")[1]}`];

  return (
    <main className="bo-main batch-page">
      <header className="bo-head">
        <div>
          <p className="muted no-print"><a className="link" href="/admin#lots">← Lots SRA3</a></p>
          <h1>Fiche de lot {batch.id}</h1>
          <p className="muted">{MEDIA[batch.media] ?? batch.media} · {m.layout.description} · retournement {m.sheet.flip === "short_edge" ? "petit côté" : "grand côté"}</p>
        </div>
        <div className="row-actions no-print">
          {batch.pdf_path && <a className="btn red small" href={`/api/admin/files/production/${batch.pdf_path}`}>PDF SRA3 pour le Fiery</a>}
          <PrintButton label="Imprimer la fiche" />
        </div>
      </header>

      <section className="tiles">
        <div className="tile"><span>Mode</span><b>{lanes ? "Piles alignées" : deck ? "Pile = jeu" : "Coupe et empile"}</b><small>{lanes ? "une pile = un seul jeu" : deck ? "chaque pile est un jeu complet" : "piles à reposer dans l'ordre"}</small></div>
        <div className="tile"><span>Feuilles SRA3</span><b>{m.sheets_count}</b><small>{m.impressions} faces imprimées</small></div>
        <div className="tile"><span>{deck ? "Livres" : "Piles"}</span><b>{deck ? books.length : m.stacks.length}</b><small>{deck ? `${(m.books ?? []).map((x) => x.sheets).join(" + ") || m.book_sheets} feuilles, une coupe par livre` : `${m.sheets_count} feuilles par coupe`}</small></div>
        <div className="tile"><span>Jeux</span><b>{lanes ? m.decks?.length ?? 0 : deck ? m.stacks.length : rows.reduce((n, r) => n + r.copies, 0)}</b><small>remplissage {Math.round(m.fill_ratio * 100)} %</small></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Mode opératoire</h2></div>
        <ol className="steps-list">
          <li>Imprimer le PDF sur <b>{MEDIA[batch.media] ?? batch.media}</b>, recto verso, retournement petit côté ({m.sheets_count} feuilles).</li>
          {deck
            ? <li>Couper <b>chaque livre de {m.book_sheets} feuilles d&apos;un seul coup</b> au massicot, en suivant les repères.</li>
            : <li>Couper les {m.sheets_count} feuilles d&apos;un seul coup au massicot, en suivant les repères.</li>}
          {lanes
            ? <li>Chaque pile n&apos;appartient qu&apos;à un seul jeu. Pour un jeu sur plusieurs piles, <b>poser la première pile sur la suivante</b>, dans l&apos;ordre indiqué ci-dessous (1/3 sur 2/3 sur 3/3) : le jeu est complet et trié.</li>
            : deck
            ? <li>Chaque pile est <b>un jeu complet et trié</b>. La carte du dessus indique la commande et l&apos;exemplaire : la retirer, mettre le jeu en étui, ranger l&apos;étui avec la commande. Le plan ci-dessous sert de contrôle.</li>
            : <li>Poser la pile 1 sur la pile 2, puis l&apos;ensemble sur la pile 3, etc. : les jeux se suivent dans l&apos;ordre des commandes.</li>}
          <li>Coins arrondis, mise en étui, puis « Imprimé ✓ » dans l&apos;atelier.</li>
        </ol>
      </section>

      {books.map((b) => {
        const stacks = m.stacks.filter((s) => (s.book ?? 1) === b);
        return (
          <section className="card map-card" key={b}>
            <div className="card-head">
              <h2>{deck ? (() => {
                const info = m.books?.find((x) => x.book === b);
                const first = info?.first_sheet ?? (b - 1) * (m.book_sheets ?? 0) + 1, count = info?.sheets ?? m.book_sheets ?? 0;
                return `Livre ${b} · feuilles ${first} à ${first + count - 1} (${count} feuilles, une coupe)`;
              })() : "Plan des piles"}</h2>
              <span className="muted">{stacks.length} pile{stacks.length > 1 ? "s" : ""}</span>
            </div>
            <div className="map-wrap">
              <SheetMap m={m} stacks={stacks} label={deck ? labelDeck : labelCompact} />
              <ul className="map-legend">
                {lanes
                  ? (m.decks ?? []).filter((d) => d.book === b).map((d) => {
                      const o = orderOf(d.job);
                      return <li key={`${d.job}-${d.copy}`}><a href={`/admin/commandes/${o?.number}`}>{o?.number ?? d.job}</a>{o && o.copies > 1 ? ` jeu ${d.copy}/${o.copies}` : ""} · {d.cards} cartes · piles {d.stacks.join(" → ")}</li>;
                    })
                  : [...new Set(stacks.map((s) => orderOf(s.job)?.number ?? s.job))].map((n) => (
                      <li key={n}><a href={`/admin/commandes/${n}`}>{n}</a> · piles {stacks.filter((s) => (orderOf(s.job)?.number ?? s.job) === n).map((s) => s.stack).join(", ")}</li>
                    ))}
              </ul>
            </div>
          </section>
        );
      })}
    </main>
  );
}
