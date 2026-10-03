// Studio Carte Blanche dans la fiche produit WooCommerce.
// Deux façons de faire son jeu : le créer en ligne (dos, visages) ou déposer son PDF.
// Dans les deux cas, le serveur contrôle la création ; le bouton « Ajouter au panier » n'apparaît
// qu'une fois la création validée, et la création part avec la ligne de panier (champ cb_job).
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Editor, { type StudioPayload } from "@/components/Editor";
import CardsEditor, { type CardsPayload } from "@/components/CardsEditor";
import { renderBack, renderCard, renderFreeCard } from "@/lib/print.ts";
import { format, formats, setFormat } from "@/lib/format.ts";
import { CB } from "@/lib/env.ts";
import { ActionBar, MediaChoice, QtyStepper } from "@/components/Flow";
import { estimate } from "@/lib/price.ts";
import { api, endpoint, post } from "@/lib/api.ts";
import PackStep, { initialPack, Mockup, needsBoxFile, packAvailable, type PackChoice, PackSummary } from "@/components/PackStep";
import { type BoxInfo, placeholderBack, renderFlat } from "@/lib/box.ts";
import "./studio.css";
import "./wp.css";

type Message = { level: "ok" | "warn" | "error"; title: string; help: string };
type Job = { uid: string; status: string; messages: Message[]; previews: string[]; error: string | null; price?: number; cards?: number | null; pack?: string; packMessages?: Message[] };
const FINAL = ["approved", "rejected", "failed"];
const CHUNK = 4 * 1024 * 1024;

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

function Report({ job, pack, media, qty, setQty, onAddToCart, onEdit }: { job: Job; pack: PackChoice; media: string; qty: number; setQty: (n: number) => void; onAddToCart: () => void; onEdit: () => void }) {
  const ok = job.status === "approved" && !job.packMessages?.length;
  const cards = job.cards ?? CB.spec.cards;
  return (
    <div className="step cb-report" aria-live="polite">
      <b className="cb-report-title">{ok ? "Votre jeu est validé" : job.status === "failed" ? "Le contrôle n'a pas abouti" : "À corriger"}</b>
      {job.previews.length > 0 && (
        <div className="previews">
          {job.previews.filter((u) => !u.includes("/preview/box")).map((u) => <img key={u} src={u} alt="Aperçu de la carte imprimée" width={150} />)}
          {job.status === "approved" && job.pack && job.pack !== "film" && (
            <Mockup pack={job.pack as PackChoice["pack"]} back={endpoint(`jobs/${job.uid}/box-back`)} cards={cards} media={media}
              design={pack.design} width={300} height={260} className="cb-report-box" />
          )}
        </div>
      )}
      <ul className="cb-messages">
        {job.messages.map((m, i) => <li key={i} className={`cb-msg ${m.level}`}><b>{m.title}</b>{m.help && <span>{m.help}</span>}</li>)}
        {job.packMessages?.map((m, i) => <li key={`p${i}`} className={`cb-msg ${m.level}`}><b>{m.title}</b>{m.help && <span>{m.help}</span>}</li>)}
        {job.error && <li className="cb-msg error"><b>{job.error}</b></li>}
      </ul>
      {ok && <PackSummary choice={{ ...pack, pack: (job.pack ?? "film") as PackChoice["pack"] }} />}
      {ok && <QtyStepper qty={qty} setQty={setQty} />}
      {ok && <ActionBar price={{ ...estimate(cards, media, job.pack ?? "film", qty), qty }} back={onEdit} next={onAddToCart} nextLabel="Ajouter au panier" />}
      <button type="button" className="link" onClick={onEdit}>{ok ? "← Modifier ma création" : job.packMessages?.length ? "← Corriger l'étui" : "← Corriger"}</button>
    </div>
  );
}

/**
 * Après validation du jeu : conditionnement choisi. Étui personnalisé : fabriqué au gabarit exact
 * (le serveur connaît maintenant le format et le nombre de cartes), envoyé et contrôlé.
 */
async function applyPack(job: Job, c: PackChoice, progress: (label: string) => void): Promise<Job> {
  if (job.status !== "approved" || c.pack === "film" || !packAvailable(c.pack)) return job;
  if (c.pack === "custom") {
    if (c.how === "online") {
      progress("Fabrication de l'étui en qualité d'impression…");
      const info = await api<BoxInfo>(`jobs/${job.uid}/box`);
      await post(`jobs/${job.uid}/file?role=box`, await renderFlat(info, c.design), "image/jpeg");
    } else if (c.file) {
      for (let offset = 0; offset < c.file.size; offset += CHUNK) {
        progress(`Envoi du PDF de l'étui… ${Math.round((offset / c.file.size) * 100)} %`);
        await post(`jobs/${job.uid}/file?role=boxpdf&offset=${offset}`, c.file.slice(offset, offset + CHUNK), "application/pdf");
      }
    }
    progress("Contrôle de l'étui…");
  }
  const r = await post<{ ok: boolean; messages: Message[] }>(`jobs/${job.uid}/pack`, JSON.stringify({ pack: c.pack }));
  const fresh = await api<Job>(`jobs/${job.uid}`);
  return r.ok ? fresh : { ...fresh, packMessages: r.messages };
}

// Titre (H1), prix, accroche et remises de la fiche produit, déplacés dans le panneau du studio
// (comme sur le site d'origine) ; le reste de la fiche (image, formulaire) est masqué par le CSS.
const productHead = document.createElement("div");
productHead.className = "cb-product-head";
function collectProductHead() {
  const scope = document.querySelector(".product") ?? document.querySelector("main") ?? document.body;
  const pick = (sel: string) => scope.querySelector<HTMLElement>(sel);
  for (const el of [pick("h1.product_title, h1.wp-block-post-title, h1"), pick(".summary .price, .wp-block-woocommerce-product-price, p.price")]) {
    if (el && !productHead.contains(el)) productHead.appendChild(el);
  }
  // Accroche et remises : repliées, pour que le studio commence tout de suite (le texte reste dans la page)
  const more = [pick(".woocommerce-product-details__short-description, .wp-block-post-excerpt"), pick(".cb-tiers")].filter((e): e is HTMLElement => !!e);
  if (more.length) {
    const details = document.createElement("details");
    details.className = "cb-more";
    details.innerHTML = "<summary>Détails et remises par quantité</summary>";
    more.forEach((e) => details.appendChild(e));
    productHead.appendChild(details);
  }
}
function ProductHead() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.appendChild(productHead); }, []);
  return <div ref={ref} />;
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

function PdfPanel({ media, setMedia, onDone, pack, setPack }: { media: string; setMedia: (m: string) => void; onDone: (job: Job) => void; pack: PackChoice; setPack: (p: Partial<PackChoice>) => void }) {
  const sample = useRef(placeholderBack());
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
      onDone(await applyPack(await waitJob(uid, () => {}), pack, (label) => setStep({ label })));
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
      <div className="field-group">
        <b>L&apos;étui</b>
        <PackStep choice={pack} set={setPack} back={sample.current} cards={sp.cardsMin ?? sp.cards} media={media} big />
      </div>
      <div className="field-group"><b>Carton</b><MediaChoice media={media} setMedia={setMedia} /></div>
      <PackSummary choice={pack} />
      <p className="cb-total"><b>{euros(estimate(sp.cardsMin ?? sp.cards, media, pack.pack).unit)}</b> <small>le jeu{sp.cardsMin ? `, pour ${sp.cardsMin} cartes (le prix suit le nombre de cartes du PDF)` : ""} · remises par quantité ensuite</small></p>
      <button type="button" className="btn red wide" disabled={!file || needsBoxFile(pack)} onClick={send}>
        {needsBoxFile(pack) ? "Ajoutez le PDF de votre étui" : "Envoyer et contrôler"}</button>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<"design" | "pdf">(CB.spec.editor ? "design" : "pdf");
  const [media, setMedia] = useState(CB.spec.media[0]?.id ?? "cmdm-350g");
  const [pack, setPackState] = useState<PackChoice>(initialPack);
  const [qty, setQtyState] = useState(Number(document.querySelector<HTMLInputElement>("form.cart input.qty")?.value) || 1);
  const setQty = (n: number) => { setQtyState(n); const i = document.querySelector<HTMLInputElement>("form.cart input.qty"); if (i) i.value = String(n); };
  const setPack = (patch: Partial<PackChoice>) => setPackState((p) => ({ ...p, ...patch }));
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
        ...p.courts.map((c) => [`court-${c.code}`, () => renderCard(c.code, p.recto, c.face, c.crop, p.style)] as [string, () => Promise<Blob>]),
      ];
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
      finish(await applyPack(await waitJob(uid, () => {}), pack, (label) => setStep({ label })));
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
      finish(await applyPack(await waitJob(uid, () => {}), pack, (label) => setStep({ label })));
    } catch (e) {
      setError((e as Error).message);
    }
    setStep(null);
  }

  const status = step ? <Progress {...step} />
    : job ? <Report job={job} pack={pack} media={media} qty={qty} setQty={setQty} onAddToCart={() => cartButton()?.click()} onEdit={() => setJobState(null)} /> : null;

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
      {error && <p className="error-text">{error}</p>}
    </div>
  );

  return (
    <div ref={top}>
      {/* L'éditeur reste monté en mode PDF : la création en cours n'est pas perdue en changeant d'avis. */}
      <div hidden={mode !== "design"}>
        {free
          ? <CardsEditor key={fmt} pack={pack} setPack={setPack} media={media} setMedia={setMedia} qty={qty} setQty={setQty} busy={!!step} header={header} status={mode === "design" ? status : null} onSubmit={submitCards}
              finish={<p className="hint">Vérifiez vos cartes : le jeu sera imprimé exactement comme l&apos;aperçu.</p>} />
          : <Editor pack={pack} setPack={setPack} media={media} setMedia={setMedia} qty={qty} setQty={setQty} busy={!!step} header={header} status={mode === "design" ? status : null} onSubmit={submitDesign}
              finish={<p className="hint">Vérifiez vos figures : le jeu sera imprimé exactement comme l&apos;aperçu.</p>} />}
      </div>
      {mode === "pdf" && (
        <div className="cb-container studio cb-pdf">
          <div className="stage-col">{CB.image && <img className="cb-pdf-image" src={CB.image} alt="" />}</div>
          <div className="panel">{header}{step || job ? status : <PdfPanel media={media} setMedia={setMedia} onDone={finish} pack={pack} setPack={setPack} />}</div>
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
  // Bas de l'en-tête collant du site : sous lui se calent l'aperçu (mobile) et la barre des étapes
  const header = document.querySelector<HTMLElement>("header.wp-block-template-part, .site-header, header");
  let frame = 0;
  const top = () => { frame = 0; document.documentElement.style.setProperty("--cb-top", `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`); };
  const queue = () => { if (!frame) frame = requestAnimationFrame(top); };
  addEventListener("scroll", queue, { passive: true }); addEventListener("resize", queue); top();
  createRoot(mount).render(<StrictMode><App /></StrictMode>);
}
