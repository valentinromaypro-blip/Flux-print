"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatEuros } from "@/lib/pricing.ts";

type Item = { id: string; title: string; details: string[]; copies: number; status: string; previews: string[];
  totalCents: number | null; messages: { level: string; title: string }[] };
type CartView = { items: Item[]; totalCents: number; payable: boolean; status?: string };

const LABELS: Record<string, string> = {
  uploaded: "Contrôle en cours", checking: "Contrôle en cours", approved: "Fichier validé", rejected: "Fichier à corriger",
  failed: "Erreur technique",
};

export default function Cart() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", line1: "", line2: "", postal_code: "", city: "", country: "FR" });

  const load = useCallback(async () => {
    const res = await fetch("/api/cart/items", { cache: "no-store" });
    setCart(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!cart?.items.some((i) => ["uploaded", "checking"].includes(i.status))) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [cart, load]);

  async function setCopies(id: string, copies: number) {
    const res = await fetch(`/api/cart/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ copies }) });
    if (!res.ok) setError((await res.json()).error);
    load();
  }
  async function remove(id: string) { await fetch(`/api/cart/items/${id}`, { method: "DELETE" }); load(); }

  async function checkout(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const { email, ...address } = form;
    const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, address }) });
    const out = await res.json();
    if (!res.ok) { setError(out.error); setBusy(false); return; }
    window.location.href = out.redirectUrl;
  }

  if (!cart) return <p className="muted">Chargement…</p>;
  if (!cart.items.length) return (
    <div style={{ paddingBottom: 80, display: "grid", gap: 20, justifyItems: "start" }}>
      <p className="muted">Votre panier est vide.</p><Link className="btn red" href="/#jeux">Choisir un jeu</Link>
    </div>);

  const f = (k: keyof typeof form) => ({ id: `f-${k}`, value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <div className="cart">
      <div>
        {cart.items.map((item) => (
          <div className="line" key={item.id}>
            {item.previews[1] || item.previews[0] ? <img src={item.previews[1] ?? item.previews[0]} alt="" /> : <div className="ph" />}
            <div style={{ display: "grid", gap: 6 }}>
              <h3>{item.title}</h3>
              <div className="details">{item.details.join(" · ")}</div>
              <div><span className={`status ${item.status}`}>{LABELS[item.status] ?? item.status}</span></div>
              {item.status === "rejected" && <p className="details">{item.messages.filter((m) => m.level === "error").map((m) => m.title).join(" · ")}</p>}
              <div className="row-actions">
                <div className="stepper">
                  <button onClick={() => setCopies(item.id, Math.max(1, item.copies - 1))} aria-label="Moins">−</button>
                  <input id={`q-${item.id}`} value={item.copies} readOnly aria-label="Quantité" />
                  <button onClick={() => setCopies(item.id, item.copies + 1)} aria-label="Plus">+</button>
                </div>
                <button className="link" onClick={() => remove(item.id)}>Retirer</button>
              </div>
            </div>
            <div className="amount">{item.totalCents != null ? formatEuros(item.totalCents) : "—"}</div>
          </div>
        ))}
      </div>
      <form className="summary" onSubmit={checkout}>
        <div className="row"><span>Sous-total</span><b>{formatEuros(cart.totalCents)}</b></div>
        <div className="row"><span>Livraison</span><span className="muted">calculée à l&apos;étape suivante</span></div>
        <div className="row grand"><span>Total</span><span>{formatEuros(cart.totalCents)}</span></div>
        <label className="field">E-mail<input type="email" required autoComplete="email" {...f("email")} /></label>
        <label className="field">Nom complet<input required autoComplete="name" {...f("name")} /></label>
        <label className="field">Adresse<input required autoComplete="address-line1" {...f("line1")} /></label>
        <label className="field">Complément<input autoComplete="address-line2" {...f("line2")} /></label>
        <div className="grid2">
          <label className="field">Code postal<input required autoComplete="postal-code" {...f("postal_code")} /></label>
          <label className="field">Ville<input required autoComplete="address-level2" {...f("city")} /></label>
        </div>
        <label className="field">Pays<select {...f("country")}><option value="FR">France</option><option value="BE">Belgique</option><option value="CH">Suisse</option><option value="LU">Luxembourg</option></select></label>
        {!cart.payable && <p className="hint">Le paiement s&apos;ouvre quand tous vos fichiers sont validés.</p>}
        {error && <p className="error-text">{error}</p>}
        <button className="btn red full" type="submit" disabled={!cart.payable || busy}>{busy ? "Redirection…" : "Payer"}</button>
      </form>
    </div>
  );
}
