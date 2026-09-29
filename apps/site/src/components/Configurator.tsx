"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@/components/Editor";
import type { Design } from "@/lib/design.ts";
import { formatEuros, priceFor } from "@/lib/pricing.ts";
import type { CustomerMessage } from "@/lib/report.ts";
import type { Product } from "@/lib/types.ts";

type ItemView = {
  id: string; status: string; messages: CustomerMessage[]; previews: string[];
  unitPriceCents: number | null; totalCents: number | null;
};

const GALLERY: Record<string, string[]> = {
  oracle: ["scene-oracle", "scene-detail", "scene-etui", "scene-hero"],
  default: ["scene-etui", "scene-hero", "scene-famille", "scene-detail"],
};

const CHECKING = ["uploaded", "checking"];

export default function Configurator({ product }: { product: Product }) {
  const images = [product.shop.image, ...(GALLERY[product.code] ?? GALLERY.default).filter((i) => i !== product.shop.image)].slice(0, 4);
  const [image, setImage] = useState(images[0]);
  const initial = useMemo(() => Object.fromEntries(Object.entries(product.options).map(([k, s]) => [k, s.default ?? ""])), [product]);
  const [options, setOptions] = useState<Record<string, string | number>>(initial);
  const [media, setMedia] = useState(product.media[0]?.code ?? "");
  const [copies, setCopies] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "uploading" | "checking" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [item, setItem] = useState<ItemView | null>(null);
  const [over, setOver] = useState(false);
  const [mode, setMode] = useState<"editor" | "upload">(product.editor ? "editor" : "upload");
  const input = useRef<HTMLInputElement>(null);
  const locked = phase !== "idle" && phase !== "error";

  const cards = typeof options.cards === "number" ? options.cards : undefined;
  const price = priceFor(product.shop.pricing, { media, cards, copies });
  const nextTier = [...product.shop.pricing.tiers].sort((a, b) => a[0] - b[0]).find(([min]) => min > copies);
  const format = typeof options.format === "string" && product.templates[options.format] ? options.format : "default";
  const pages = cards !== undefined ? (options.backs === "individual" ? cards * 2 : cards + 1) : product.page_count;

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 240; i++) {
      const res = await fetch(`/api/cart/items/${id}`);
      if (res.ok) {
        const view = (await res.json()) as ItemView;
        setItem(view);
        if (!CHECKING.includes(view.status)) { setPhase("done"); return; }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setPhase("error");
    setError("Le contrôle prend plus de temps que prévu. Votre fichier est bien reçu : retrouvez-le dans votre panier.");
  }, []);

  async function upload(f: File) {
    if (f.type && f.type !== "application/pdf") { setError("Déposez un fichier PDF."); setPhase("error"); return; }
    setFile(f); setError(""); setItem(null); setPhase("uploading"); setProgress(0);
    try {
      const prep = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: product.code, size: f.size }) });
      const target = await prep.json();
      if (!prep.ok) throw new Error(target.error);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(target.target.method, target.target.url);
        Object.entries(target.target.headers as Record<string, string>).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("L'envoi du fichier a échoué.")));
        xhr.onerror = () => reject(new Error("L'envoi du fichier a échoué. Vérifiez votre connexion."));
        xhr.send(f);
      });
      const created = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: product.code, media, options, copies, path: target.path }) });
      const out = await created.json();
      if (!created.ok) throw new Error(out.error);
      setPhase("checking");
      poll(out.id);
    } catch (e) {
      setPhase("error"); setError((e as Error).message);
    }
  }

  async function submitDesign(design: Design) {
    setError(""); setItem(null); setPhase("checking");
    try {
      const created = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: product.code, media, options, copies, design }) });
      const out = await created.json();
      if (!created.ok) throw new Error(out.error);
      poll(out.id);
    } catch (e) {
      setPhase("error"); setError((e as Error).message);
    }
  }

  async function restart() {
    if (item && item.status !== "approved") await fetch(`/api/cart/items/${item.id}`, { method: "DELETE" });
    setItem(null); setFile(null); setPhase("idle"); setProgress(0);
  }

  useEffect(() => { setImage(images[0]); }, [product.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string | number) => setOptions((o) => ({ ...o, [k]: v }));
  const approved = item?.status === "approved";
  const rejected = item?.status === "rejected" || item?.status === "failed";

  return (
    <div className="container config">
      <div className="gallery">
        <div className="main"><img src={`/img/${image}.jpg`} alt={product.shop.title} /></div>
        <div className="thumbs">
          {images.map((i) => (
            <button key={i} aria-pressed={i === image} onClick={() => setImage(i)} aria-label="Voir cette photo"><img src={`/img/${i}.jpg`} alt="" /></button>
          ))}
        </div>
      </div>

      <div>
        <div className="panel-title">
          <h1>{product.shop.title}</h1>
          <p>{product.shop.description}</p>
        </div>

        {Object.entries(product.options).map(([key, spec]) => (
          <div className="block" key={key}>
            <h2>{spec.label}{spec.kind === "number" && <small>{spec.min} à {spec.max}</small>}</h2>
            {spec.kind === "choice" ? (
              <div className="chips">
                {Object.entries(spec.choices ?? {}).map(([value, label]) => (
                  <button key={value} className="chip" aria-pressed={options[key] === value} disabled={locked}
                    onClick={() => set(key, value)}>{label}</button>
                ))}
              </div>
            ) : (
              <div className="range">
                <input type="range" id={`opt-${key}`} min={spec.min} max={spec.max} step={spec.step ?? 1} value={Number(options[key])}
                  disabled={locked} onChange={(e) => set(key, Number(e.target.value))} aria-label={spec.label} />
                <div className="stepper">
                  <button disabled={locked} onClick={() => set(key, Math.max(spec.min ?? 1, Number(options[key]) - 1))} aria-label="Moins">−</button>
                  <input id={`opt-${key}-n`} inputMode="numeric" value={options[key]} disabled={locked} aria-label={spec.label}
                    onChange={(e) => set(key, Math.min(spec.max ?? 999, Math.max(spec.min ?? 1, Number(e.target.value) || 0)))} />
                  <button disabled={locked} onClick={() => set(key, Math.min(spec.max ?? 999, Number(options[key]) + 1))} aria-label="Plus">+</button>
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="block">
          <h2>Carton</h2>
          <div className="media-list">
            {product.media.map((m) => (
              <button key={m.code} className="media-opt" aria-pressed={media === m.code} disabled={locked} onClick={() => setMedia(m.code)}>
                <b>{m.label}</b><span>{m.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="block">
          <h2>Quantité<small>exemplaires du même jeu</small></h2>
          <div className="row-actions">
            <div className="stepper">
              <button disabled={locked} onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="Moins">−</button>
              <input id="copies" inputMode="numeric" value={copies} disabled={locked} aria-label="Quantité"
                onChange={(e) => setCopies(Math.min(500, Math.max(1, Number(e.target.value) || 1)))} />
              <button disabled={locked} onClick={() => setCopies((c) => Math.min(500, c + 1))} aria-label="Plus">+</button>
            </div>
            {nextTier && <span className="hint">Dès {nextTier[0]} exemplaires : −{Math.round((1 - nextTier[1]) * 100)} % sur chaque jeu</span>}
          </div>
          <div className="price-box">
            <div><div className="unit">{formatEuros(price.unitCents)} le jeu{price.tierDiscount ? ` (−${price.tierDiscount} %)` : ""}</div>
              <div className="total">{formatEuros(price.totalCents)}</div></div>
            <span className="hint">TTC, hors livraison</span>
          </div>
        </div>

        <div className="block">
          <h2>{mode === "editor" ? "Votre jeu" : "Votre fichier"}{mode === "upload" && <small>PDF de {pages} pages</small>}</h2>
          {product.editor && (phase === "idle" || phase === "error") && (
            <div className="chips" role="tablist">
              <button className="chip" role="tab" aria-pressed={mode === "editor"} onClick={() => setMode("editor")}>Créer en ligne</button>
              <button className="chip" role="tab" aria-pressed={mode === "upload"} onClick={() => setMode("upload")}>J&apos;ai mon fichier PDF</button>
            </div>
          )}
          {mode === "editor" && (phase === "idle" || phase === "error") && (
            <>
              <Editor product={product.code} disabled={false} onSubmit={submitDesign} />
              {error && <p className="error-text">{error}</p>}
            </>
          )}
          {mode === "upload" && (
          <p className="hint">
            Partez de notre gabarit : il contient le fond perdu, la zone de sécurité et l&apos;ordre des pages.{" "}
            <a className="link" href={`/api/templates/${product.code}/${format}`}>Télécharger le gabarit</a>
          </p>
          )}

          {mode === "editor" && (phase === "idle" || phase === "error") ? null : phase === "idle" || phase === "error" ? (
            <>
              <div className={`dropzone${over ? " over" : ""}`} role="button" tabIndex={0}
                onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
                <b>Déposez votre PDF ici</b>
                <span className="hint">ou cliquez pour le choisir · 300 Mo maximum</span>
                <input ref={input} id="file" type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </div>
              {error && <p className="error-text">{error}</p>}
              {!product.editor && <div className="soon">Pas de logiciel de graphisme ? La création en ligne arrive bientôt sur ce produit.</div>}
            </>
          ) : (
            <div className="check" aria-live="polite">
              {phase === "uploading" && (
                <><p><span className="spinner" />Envoi de {file?.name} · {progress} %</p>
                  <div className="progress"><i style={{ width: `${progress}%` }} /></div></>
              )}
              {phase === "checking" && <p><span className="spinner" />{mode === "editor"
                ? "Fabrication de vos 55 cartes en qualité d'impression, puis contrôle… (environ 20 secondes)"
                : "Contrôle de votre fichier : format, fond perdu, images, polices…"}</p>}
              {item?.messages.map((m, i) => (
                <div className={`msg ${m.level}`} key={i}>
                  <b>{m.title}</b><span>{m.help}</span>
                  {m.cards.length > 0 && <span className="cards">{m.cards.slice(0, 6).join(" · ")}{m.cards.length > 6 ? ` et ${m.cards.length - 6} autres` : ""}</span>}
                </div>
              ))}
              {item && item.previews.length > 0 && (
                <div className="previews">{item.previews.map((p) => <img key={p} src={p} alt="Aperçu d'une carte de votre fichier" />)}</div>
              )}
              {phase === "done" && approved && (
                <div className="row-actions">
                  <Link className="btn red" href="/panier">Ajouté au panier · voir le panier</Link>
                  <button className="link" onClick={restart}>Créer un autre jeu</button>
                </div>
              )}
              {phase === "done" && rejected && (
                <div className="row-actions">
                  <button className="btn" onClick={restart}>Déposer un fichier corrigé</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
