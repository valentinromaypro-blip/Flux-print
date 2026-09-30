// Studio Carte Blanche dans la fiche produit WooCommerce.
// Deux façons de faire son jeu : le créer en ligne (dos, visages) ou déposer son PDF.
// Dans les deux cas, le serveur contrôle la création ; le bouton « Ajouter au panier » n'apparaît
// qu'une fois la création validée, et la création part avec la ligne de panier (champ cb_job).
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Editor, { type StudioPayload } from "@/components/Editor";
import CardsEditor, { type CardsPayload } from "@/components/CardsEditor";
import { renderBack, renderCard, renderFreeCard } from "@/lib/print.ts";
import { deckCodes, drawnHere } from "@/lib/recto.ts";
import { format, formats, setFormat } from "@/lib/format.ts";
import { CB } from "@/lib/env.ts";
import "./studio.css";
import "./wp.css";

type Message = { level: "ok" | "warn" | "error"; title: string; help: string };
type Job = { uid: string; status: string; messages: Message[]; previews: string[]; error: string | null; price?: number; cards?: number | null };
const FINAL = ["approved", "rejected", "failed"];
const CHUNK = 4 * 1024 * 1024;

// Pas de jeton WordPress : l'API reconnaît le visiteur par son cookie de session Carte Blanche,
// ce qui reste valable même si la page est servie depuis un cache.
// Adresse de l'API : `CB.rest` vaut « …/wp-json/cb/v1/ » ou, sans permaliens, « …/?rest_route=/cb/v1/ ».
function endpoint(path: string) {
  const [route, query] = path.split("?");
  return CB.rest + route + (query ? (CB.rest.includes("?") ? "&" : "?") + query : "");
}
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(endpoint(path), { credentials: "same-origin", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
  return body as T;
}
const post = <T,>(path: string, body: BodyInit, type = "application/json") =>
  api<T>(path, { method: "POST", body, headers: { "Content-Type": type } });

async function createJob(kind: "design" | "pdf", media: string) {
  return (await post<{ uid: string }>("jobs", JSON.stringify({ product_id: CB.productId, kind, media, format: format().key }))).uid;
}
const euros = (v: number) => v.toFixed(2).replace(".", ",") + " €";
const mm = (v: number) => v.toFixed(1).replace(".", ",").replace(",0", "");
async function waitJob(uid: string, onUpdate: (j: Job) => void): Promise<Job> {
  for (let i = 0; ; i++) {
    const job = await api<Job>(`jobs/${uid}`);
    onUpdate(job);
    if (FINAL.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 4000));
  }
}

/** Le bouton natif de WooCommerce : caché tant que la création n'est pas validée. */
function cartButton() {
  return document.querySelector<HTMLButtonElement>("form.cart .single_add_to_cart_button, form.cart button[name='add-to-cart']");
}
function showCart(on: boolean) {
  const b = cartButton();
  if (b) b.style.display = on ? "" : "none"; // `hidden` ne suffit pas : les thèmes imposent leur display
}
function setJob(uid: string | null) {
  const input = document.getElementById("cb-job") as HTMLInputElement | null;
  if (input) input.value = uid ?? "";
}

function Report({ job, onAddToCart, onEdit }: { job: Job; onAddToCart: () => void; onEdit: () => void }) {
  const ok = job.status === "approved";
  return (
    <div className="step cb-report" aria-live="polite">
      <b className="cb-report-title">{ok ? "Votre jeu est validé" : job.status === "failed" ? "Le contrôle n'a pas abouti" : "À corriger"}</b>
      {job.previews.length > 0 && (
        <div className="previews">{job.previews.map((u) => <img key={u} src={u} alt="Aperçu de la carte imprimée" width={150} />)}</div>
      )}
      <ul className="cb-messages">
        {job.messages.map((m, i) => <li key={i} className={`cb-msg ${m.level}`}><b>{m.title}</b>{m.help && <span>{m.help}</span>}</li>)}
        {job.error && <li className="cb-msg error"><b>{job.error}</b></li>}
      </ul>
      {ok && job.price !== undefined && <p className="cb-price">{euros(job.price)} <small>l&apos;exemplaire{job.cards && CB.spec.cardsMin ? ` · ${job.cards} cartes` : ""} · remises par quantité au panier</small></p>}
      {ok && <Quantity />}
      {ok && <button type="button" className="btn red wide" onClick={onAddToCart}>Ajouter au panier</button>}
      <button type="button" className="link" onClick={onEdit}>{ok ? "← Modifier ma création" : "← Corriger"}</button>
    </div>
  );
}

// Titre (H1), prix, accroche et remises de la fiche produit, déplacés dans le panneau du studio
// (comme sur le site d'origine) ; le reste de la fiche (image, formulaire) est masqué par le CSS.
const productHead = document.createElement("div");
productHead.className = "cb-product-head";
function collectProductHead() {
  const scope = document.querySelector(".product") ?? document.querySelector("main") ?? document.body;
  const pick = (sel: string) => scope.querySelector<HTMLElement>(sel);
  for (const el of [
    pick("h1.product_title, h1.wp-block-post-title, h1"),
    pick(".summary .price, .wp-block-woocommerce-product-price, p.price"),
    pick(".woocommerce-product-details__short-description, .wp-block-post-excerpt"),
    pick(".cb-tiers"),
  ]) if (el && !productHead.contains(el)) productHead.appendChild(el);
}
function ProductHead() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.appendChild(productHead); }, []);
  return <div ref={ref} />;
}

/** Quantité : saisie dans le studio, reportée dans le formulaire WooCommerce (masqué) avant l'envoi. */
function Quantity() {
  const input = document.querySelector<HTMLInputElement>("form.cart input.qty");
  const [qty, setQty] = useState(Number(input?.value) || 1);
  if (!input) return null;
  const set = (v: number) => { const n = Math.max(1, Math.min(999, v || 1)); setQty(n); input.value = String(n); };
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

function Progress({ label, value }: { label: string; value?: number }) {
  return (
    <div className="step cb-progress" aria-live="polite">
      <span className="spinner" />
      <b>{label}</b>
      {value !== undefined && <div className="cb-bar"><i style={{ width: `${Math.round(value * 100)}%` }} /></div>}
    </div>
  );
}

function PdfPanel({ media, onDone }: { media: string; onDone: (job: Job) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<{ label: string; value?: number } | null>(null);
  const [error, setError] = useState("");
  const sp = CB.spec;
  const pagesFor = (n: number) => (sp.backs === "individual" ? 2 * n : n + 1);
  const pages = sp.cardsMin ? `de ${pagesFor(sp.cardsMin)} à ${pagesFor(sp.cardsMax!)} pages` : `${pagesFor(sp.cards)} pages`;
  const order = sp.backs === "individual" ? "recto verso alternés : face 1, dos 1, face 2, dos 2…"
    : "le dos en page 1, puis les faces (pique, cœur, carreau, trèfle ; de l'as au roi ; puis les jokers)";
  const sizes = sp.formats.map((f) => `${mm(f.page[0])} × ${mm(f.page[1])} mm (${f.label.split(" ")[0].toLowerCase()})`).join(" ou ");

  async function send() {
    if (!file) return;
    setError("");
    try {
      setStep({ label: "Préparation…" });
      const uid = await createJob("pdf", media);
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        setStep({ label: "Envoi du fichier…", value: offset / file.size });
        await post(`jobs/${uid}/file?role=pdf&offset=${offset}`, file.slice(offset, offset + CHUNK), "application/pdf");
      }
      setStep({ label: "Contrôle du fichier (pages, format, fond perdu)…" });
      await post(`jobs/${uid}/submit`, "{}");
      onDone(await waitJob(uid, () => {}));
    } catch (e) {
      setError((e as Error).message);
    }
    setStep(null);
  }

  if (step) return <Progress {...step} />;
  return (
    <div className="step">
      <p className="hint">
        Un PDF de <b>{pages}</b>{sp.cardsMin ? ` (${sp.cardsMin} à ${sp.cardsMax} cartes)` : ""} : {order}.
        Chaque page mesure <b>{sizes}</b>, soit 3 mm de fond perdu autour de la carte.
      </p>
      <label className={`cb-drop${file ? " on" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
        <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? <><b>{file.name}</b><span>{(file.size / 1048576).toFixed(1).replace(".", ",")} Mo · cliquez pour changer</span></>
          : <><b>Choisir mon PDF</b><span>ou le glisser ici</span></>}
      </label>
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn red wide" disabled={!file} onClick={send}>Envoyer et contrôler</button>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<"design" | "pdf">(CB.spec.editor ? "design" : "pdf");
  const [media, setMedia] = useState(CB.spec.media[0]?.id ?? "cmdm-350g");
  const [fmt, setFmt] = useState(format().key);
  const free = !!CB.spec.cardsMin; // oracle : cartes libres
  const [step, setStep] = useState<{ label: string; value?: number } | null>(null);
  const [job, setJobState] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ok = job?.status === "approved";
    setJob(ok ? job!.uid : null);
    showCart(ok);
  }, [job]);

  function finish(j: Job) {
    setJobState(j);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitDesign(p: StudioPayload) {
    setError("");
    try {
      setStep({ label: "Préparation…" });
      const uid = await createJob("design", media);
      const cards: [string, () => Promise<Blob>][] = [
        ["back", () => renderBack(p)],
      ];
      // Figures personnalisées ; en modèle moderne, tout le jeu (l'atelier n'a que les cartes classiques)
      const faces = new Map(p.courts.map((c) => [c.code, c]));
      for (const code of deckCodes(CB.deck)) {
        const c = faces.get(code);
        if (drawnHere(p.recto, code, !!c)) {
          cards.push([`${c ? "court" : "front"}-${code}`, () => renderCard(code, p.recto, c?.face ?? null, c?.crop ?? { zoom: 1, x: 0.5, y: 0.5 }, p.style)]);
        }
      }
      for (const [i, [role, render]] of cards.entries()) {
        setStep({ label: `Fabrication des cartes en qualité d'impression (${i + 1}/${cards.length})…`, value: i / cards.length });
        await post(`jobs/${uid}/file?role=${role}`, await render(), "image/jpeg");
      }
      setStep({ label: "Contrôle…" });
      const design = {
        template: p.back.template, bg: p.back.bg, ink: p.back.ink, title: p.back.title, subtitle: p.back.subtitle,
        logo: !!p.back.logo, photo: !!p.back.photo, style: p.style, recto: p.recto, courts: p.courts.map((c) => c.code),
      };
      await post(`jobs/${uid}/submit`, JSON.stringify({ design }));
      finish(await waitJob(uid, () => {}));
    } catch (e) {
      setError((e as Error).message);
    }
    setStep(null);
  }

  async function submitCards(p: CardsPayload) {
    setError("");
    try {
      setStep({ label: "Préparation…" });
      const uid = await createJob("design", media);
      const bleed: [number, number] = [CB.bleedMm / format().page[0], CB.bleedMm / format().page[1]];
      const files: [string, () => Promise<Blob>][] = [
        ["back", () => renderBack(p)],
        ...p.cards.map((c, i) => [`card-${String(i + 1).padStart(3, "0")}`, () => renderFreeCard(c, p.look, bleed)] as [string, () => Promise<Blob>]),
      ];
      for (const [i, [role, render]] of files.entries()) {
        setStep({ label: `Fabrication des cartes en qualité d'impression (${i + 1}/${files.length})…`, value: i / files.length });
        await post(`jobs/${uid}/file?role=${role}`, await render(), "image/jpeg");
      }
      setStep({ label: "Contrôle…" });
      const design = { template: p.back.template, bg: p.back.bg, ink: p.back.ink, title: p.back.title, subtitle: p.back.subtitle,
        logo: !!p.back.logo, photo: !!p.back.photo, format: format().key, cards: p.cards.length, titles: p.cards.map((c) => c.title), look: p.look };
      await post(`jobs/${uid}/submit`, JSON.stringify({ design }));
      finish(await waitJob(uid, () => {}));
    } catch (e) {
      setError((e as Error).message);
    }
    setStep(null);
  }

  const status = step ? <Progress {...step} />
    : job ? <Report job={job} onAddToCart={() => cartButton()?.click()} onEdit={() => setJobState(null)} /> : null;

  const header = (
    <div className="cb-head">
      <ProductHead />
      {CB.spec.editor && (
        <div className="seg" role="radiogroup" aria-label="Façon de créer le jeu">
          <button type="button" role="radio" aria-checked={mode === "design"} disabled={!!step} onClick={() => { setMode("design"); setJobState(null); }}>Créer en ligne</button>
          <button type="button" role="radio" aria-checked={mode === "pdf"} disabled={!!step} onClick={() => { setMode("pdf"); setJobState(null); }}>J&apos;ai mon fichier PDF</button>
        </div>
      )}
      {formats().length > 1 && (
        <div className="seg" role="radiogroup" aria-label="Format des cartes">
          {formats().map((f) => (
            <button type="button" key={f.key} role="radio" aria-checked={fmt === f.key} disabled={!!step || !!job}
              onClick={() => { setFormat(f.key); setFmt(f.key); }}>{f.label}</button>
          ))}
        </div>
      )}
      {CB.spec.media.length > 1 && (
        <div className="cb-media" role="radiogroup" aria-label="Carton">
          {CB.spec.media.map((m) => (
            <button type="button" key={m.id} role="radio" aria-checked={media === m.id} disabled={!!step || !!job} onClick={() => setMedia(m.id)}>
              <b>{m.label}</b><span>{m.hint}{m.delta ? ` · ${m.delta > 0 ? "+" : "−"}${euros(Math.abs(m.delta))}` : ""}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );

  return (
    <div ref={top}>
      {/* L'éditeur reste monté en mode PDF : la création en cours n'est pas perdue en changeant d'avis. */}
      <div hidden={mode !== "design"}>
        {free
          ? <CardsEditor key={fmt} busy={!!step} header={header} status={mode === "design" ? status : null} onSubmit={submitCards}
              finish={<p className="hint">Vérifiez vos cartes : le jeu sera imprimé exactement comme l&apos;aperçu.</p>} />
          : <Editor busy={!!step} header={header} status={mode === "design" ? status : null} onSubmit={submitDesign}
              finish={<p className="hint">Vérifiez vos figures : le jeu sera imprimé exactement comme l&apos;aperçu.</p>} />}
      </div>
      {mode === "pdf" && (
        <div className="cb-container studio cb-pdf">
          <div className="stage-col">{CB.image && <img className="cb-pdf-image" src={CB.image} alt="" />}</div>
          <div className="panel">{header}{step || job ? status : <PdfPanel media={media} onDone={finish} />}</div>
        </div>
      )}
    </div>
  );
}

const mount = document.getElementById("cb-studio");
if (mount) {
  // Le studio sort du formulaire d'ajout au panier (ses boutons ne doivent pas l'envoyer) et prend
  // toute la largeur, au-dessus de la fiche produit.
  const product = mount.closest(".product");
  if (product?.parentElement) product.parentElement.insertBefore(mount, product);
  showCart(false);
  setFormat(CB.spec.formats[0].key);
  collectProductHead();
  document.body.classList.add("cb-has-studio");
  createRoot(mount).render(<StrictMode><App /></StrictMode>);
}
