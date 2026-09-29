import type { ReactNode } from "react";
import { sql } from "@/lib/db.ts";

// Habillage de l'atelier : barre latérale commune au tableau de bord et aux fiches commande.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [{ last, todo }] = await sql()<{ last: Date | null; todo: number }[]>`
    select (select max(created_at) from public.events) as last,
           ((select count(*) from public.orders where status = 'printed')
            + (select count(*) from public.batches where status in ('generated', 'dispatched'))
            + (select count(*) from public.order_items where status = 'failed'))::int as todo`;
  const minutes = last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null;
  const ago = minutes == null ? "—" : minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} j`;
  return (
    <div className="bo">
      <aside className="bo-nav">
        <div className="bo-logo">Carte <span>Blanche</span><small>Atelier</small></div>
        <nav>
          <a href="/admin#pilotage">Pilotage</a>
          <a href="/admin#a-faire">À faire {todo > 0 && <i>{todo}</i>}</a>
          <a href="/admin#production">Production</a>
          <a href="/admin#presse">Presse</a>
          <a href="/admin#commandes">Commandes</a>
          <a href="/admin#lots">Lots SRA3</a>
        </nav>
        <div className={`engine ${minutes != null && minutes < 1440 ? "ok" : "off"}`}><i />Moteur · dernière activité {ago}</div>
        <a className="bo-shop" href="/">← Voir la boutique</a>
      </aside>
      {children}
    </div>
  );
}
