import type { ReactNode } from "react";
import { CB } from "@/lib/env.ts";
import { estimate, euros } from "@/lib/price.ts";

// Navigation du studio : barre des étapes (faites, en cours, à venir, avec un résumé), barre
// d'action collante (prix à jour, retour, suite) et récapitulatif avant validation.

export type StepInfo = { label: string; note?: string };

export function StepBar({ steps, step, go, busy }: { steps: StepInfo[]; step: number; go: (i: number) => void; busy: boolean }) {
  return (
    <ol className="steps cb-stepbar">
      {steps.map((s, i) => (
        <li key={s.label}>
          <button type="button" aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""} onClick={() => go(i)} disabled={busy}>
            <span>{i < step ? "✓" : i + 1}</span>
            <em><b>{s.label}</b>{s.note && <small>{s.note}</small>}</em>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Barre collante : en bas de l'écran sur mobile, en bas du panneau sur ordinateur. */
export function ActionBar({ price, position, back, next, nextLabel, disabled, hint }: {
  price: { unit: number; total: number; discount: number; qty: number }; position?: string;
  back?: () => void; next: () => void; nextLabel: string; disabled?: boolean; hint?: string;
}) {
  return (
    <div className="cb-actionbar" role="region" aria-label="Navigation de la création">
      <div className="cb-total">
        <b>{euros(price.qty > 1 ? price.total : price.unit)}</b>
        <small>{price.qty > 1 ? `${price.qty} jeux · ${euros(price.unit)} l'unité` : "le jeu"}{price.discount ? ` · −${price.discount} %` : ""}{position ? ` · étape ${position}` : ""}</small>
      </div>
      <div className="cb-actions">
        {back && <button type="button" className="btn ghost" onClick={back} aria-label="Étape précédente">←</button>}
        <button type="button" className="btn red" onClick={next} disabled={disabled} title={hint}>{nextLabel}</button>
      </div>
      {disabled && hint && <p className="cb-actionbar-hint">{hint}</p>}
    </div>
  );
}

/** Quantité, reportée dans le formulaire WooCommerce (masqué) qui part au panier. */
export function QtyStepper({ qty, setQty }: { qty: number; setQty: (n: number) => void }) {
  const set = (v: number) => setQty(Math.max(1, Math.min(999, v || 1)));
  return (
    <div className="cb-qty">
      <span>Quantité</span>
      <div className="stepper">
        <button type="button" onClick={() => set(qty - 1)} aria-label="Un de moins">−</button>
        <input type="number" min={1} value={qty} onChange={(e) => set(Number(e.target.value))} aria-label="Nombre de jeux" />
        <button type="button" onClick={() => set(qty + 1)} aria-label="Un de plus">+</button>
      </div>
    </div>
  );
}

export function MediaChoice({ media, setMedia, locked }: { media: string; setMedia: (m: string) => void; locked?: boolean }) {
  if (CB.spec.media.length < 2) return null;
  return (
    <div className="cb-media" role="radiogroup" aria-label="Carton">
      {CB.spec.media.map((m) => (
        <button type="button" key={m.id} role="radio" aria-checked={media === m.id} disabled={locked} onClick={() => setMedia(m.id)}>
          <b>{m.label}</b><span>{m.hint}{m.delta ? ` · ${m.delta > 0 ? "+" : "−"}${euros(Math.abs(m.delta))}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

/** Récapitulatif avant validation : ce qui sera fabriqué, carton, quantité, prix. */
export function Recap({ visual, lines, media, setMedia, qty, setQty, cards, pack, children }: {
  visual: ReactNode; lines: [string, string][]; media: string; setMedia: (m: string) => void;
  qty: number; setQty: (n: number) => void; cards: number; pack: string; children?: ReactNode;
}) {
  const p = estimate(cards, media, pack, qty);
  const next = CB.spec.pricing.tiers.find(([min]) => min > qty);
  return (
    <div className="step cb-recap">
      <div className="cb-recap-head">
        <div className="cb-recap-visual">{visual}</div>
        <dl>{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
      <div className="field-group"><b>Carton</b><MediaChoice media={media} setMedia={setMedia} /></div>
      <QtyStepper qty={qty} setQty={setQty} />
      <p className="cb-recap-price">
        <b>{euros(p.total)}</b> {qty > 1 && <span>soit {euros(p.unit)} le jeu{p.discount ? ` (−${p.discount} %)` : ""}</span>}
        {next && <small>Dès {next[0]} jeux : −{Math.round((1 - next[1]) * 100)} % sur les cartes</small>}
      </p>
      {children}
    </div>
  );
}
