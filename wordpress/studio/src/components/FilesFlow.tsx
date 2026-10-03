import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { endpoint } from "@/lib/api.ts";
import { placeholderBack } from "@/lib/box.ts";
import { CB } from "@/lib/env.ts";
import { format } from "@/lib/format.ts";
import { estimate } from "@/lib/price.ts";
import { deckCodes } from "@/lib/recto.ts";
import { ActionBar, Recap, StepBar } from "@/components/Flow";
import PackStep, { needsBoxFile, type PackChoice, packOffer, StageMockup } from "@/components/PackStep";

// « J'ai mes fichiers » : pour qui crée son jeu lui-même (Canva, Illustrator, Photoshop…).
// 1. Vos fichiers : kit de création (gabarits au format exact), puis un PDF ou une image par carte
// 2. L'étui · 3. Récapitulatif. Le serveur contrôle ensuite et montre le jeu entier, carte par carte.

export type Slot = { key: string; label: string; file: File | null; url: string; warn?: string };
export type FilesPayload = { kind: "pdf"; file: File } | { kind: "images"; slots: Slot[] };

const SUIT_NAMES: Record<string, string> = { S: "pique", H: "cœur", D: "carreau", C: "trèfle" };
const RANK_NAMES: Record<string, string> = { A: "As", J: "Valet", Q: "Dame", K: "Roi" };
export const cardName = (code: string) => {
  const [s, r] = code.split("-");
  return s === "JK" ? `Joker ${r}` : `${RANK_NAMES[r] ?? r} de ${SUIT_NAMES[s]}`;
};
const mm = (v: number) => v.toFixed(1).replace(".", ",").replace(",0", "");

// --- Rangement des images d'après leur nom --------------------------------------------------------

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.[a-z0-9]+$/, "");
const SUIT_WORDS: [RegExp, string][] = [[/^(piques?|spades?)$/, "S"], [/^(coeurs?|hearts?)$/, "H"], [/^(carreaux?|diamonds?)$/, "D"], [/^(trefles?|clubs?)$/, "C"]];
const RANK_WORDS: [RegExp, string][] = [[/^(as|ace|a|1)$/, "A"], [/^(valet|jack|j|v)$/, "J"], [/^(dame|queen|q|d)$/, "Q"], [/^(roi|king|k|r)$/, "K"], [/^(10|[2-9])$/, ""]];

/** Code de carte (« H-A »), « back », « JK-n », ou null si le nom ne dit rien. */
export function codeFromName(name: string): string | null {
  const n = norm(name);
  const compact = n.replace(/[^a-z0-9]/g, "");
  if (/(^|[^a-z])(dos|back|verso|revers)([^a-z]|$)/.test(n)) return "back";
  const jk = n.match(/joker\D*([12])?/);
  if (jk) return `JK-${jk[1] ?? "1"}`;
  const code = compact.match(/^([shdc])(a|10|[2-9]|j|q|k)$/) ?? compact.match(/^(a|10|[2-9]|j|q|k)([shdc])$/);
  if (code) {
    const [x, y] = /^[shdc]$/.test(code[1]) ? [code[1], code[2]] : [code[2], code[1]];
    return `${x.toUpperCase()}-${y.toUpperCase()}`;
  }
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  let suit = "", rank = "";
  for (const t of tokens) {
    for (const [re, s] of SUIT_WORDS) if (re.test(t)) suit = s;
  }
  if (!suit) return null;
  for (const t of tokens) {
    for (const [re, r] of RANK_WORDS) if (re.test(t)) rank = r || t;
  }
  return rank ? `${suit}-${rank}` : null;
}

/** Range les images dans les cases : par nom si possible, sinon (et pour le reste) dans l'ordre. */
export function assignFiles(slots: Slot[], files: File[]): Slot[] {
  const next = slots.map((s) => ({ ...s }));
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
  const named = sorted.map((f) => codeFromName(f.name));
  const useNames = named.filter((c) => c && next.some((s) => s.key === c)).length >= Math.min(sorted.length, Math.ceil(sorted.length * 0.8));
  const rest: File[] = [];
  sorted.forEach((f, i) => {
    const slot = useNames && named[i] ? next.find((s) => s.key === named[i] && !s.file) : undefined;
    if (slot) { slot.file = f; slot.url = URL.createObjectURL(f); } else rest.push(f);
  });
  for (const f of rest) {
    const slot = next.find((s) => !s.file);
    if (!slot) break;
    slot.file = f; slot.url = URL.createObjectURL(f);
  }
  return next;
}

/** Résolution et proportions d'une image par rapport à la carte (fond perdu compris). */
async function inspect(url: string): Promise<string | undefined> {
  const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
  const [pw, ph] = format().page, [tw, th] = format().trim;
  const r = img.naturalWidth / img.naturalHeight;
  const dpi = Math.round(img.naturalWidth / (pw / 25.4));
  const close = (a: number, b: number) => Math.abs(a - b) / b < 0.01;
  if (!close(r, pw / ph) && !close(r, tw / th)) return "proportions différentes : image recadrée";
  if (dpi < 200) return `résolution faible (${dpi} dpi) : risque de flou`;
  if (close(r, tw / th) && !close(r, pw / ph)) return "sans fond perdu : bords prolongés";
  return undefined;
}

export default function FilesFlow({ header, status, busy, media, setMedia, qty, setQty, pack, setPack, onSend }: {
  header: ReactNode; status: ReactNode; busy: boolean; media: string; setMedia: (m: string) => void;
  qty: number; setQty: (n: number) => void; pack: PackChoice; setPack: (p: Partial<PackChoice>) => void;
  onSend: (p: FilesPayload) => void;
}) {
  const sp = CB.spec;
  const free = !!sp.cardsMin;
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"pdf" | "images">("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [kitCards, setKitCards] = useState(sp.cards);
  const initial = useMemo<Slot[]>(() => [{ key: "back", label: "Dos", file: null, url: "" },
    ...deckCodes(CB.deck).map((c) => ({ key: c, label: cardName(c), file: null, url: "" }))], []);
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null), imgInput = useRef<HTMLInputElement>(null), oneInput = useRef<HTMLInputElement>(null);
  const replaceAt = useRef(0);
  const sample = useRef(placeholderBack());
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.querySelector(".steps")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [step]);

  // Avertissements par image (résolution, proportions)
  useEffect(() => {
    slots.forEach((s, i) => {
      if (s.url && s.warn === undefined) inspect(s.url).then((w) => setSlots((all) => all.map((x, j) => (j === i && x.url === s.url ? { ...x, warn: w ?? "" } : x)))).catch(() => {});
    });
  }, [slots]);

  const filled = slots.filter((s) => s.file).length;
  const ready = kind === "pdf" ? !!file : filled === slots.length;
  const backUrl = kind === "images" && slots[0].url ? slots[0].url : sample.current;
  const cards = free ? kitCards : sp.cards;
  const fmtKey = format().key;
  const kit = (f = "") => endpoint(`kit?product_id=${CB.productId}&format=${fmtKey}${free ? `&cards=${kitCards}` : ""}${f ? `&file=${f}` : ""}`);
  const pages = sp.backs === "individual" ? 2 * cards : cards + 1;
  const [pw, ph] = format().page;
  const need = kind === "pdf" ? "Choisissez votre PDF" : `Encore ${slots.length - filled} image${slots.length - filled > 1 ? "s" : ""}`;

  function addImages(files: File[]) {
    const imgs = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (imgs.length) setSlots((all) => assignFiles(all, imgs));
  }
  function swap(a: number, b: number) {
    setSlots((all) => { const n = all.map((s) => ({ ...s })); [n[a].file, n[b].file, n[a].url, n[b].url, n[a].warn, n[b].warn] = [n[b].file, n[a].file, n[b].url, n[a].url, n[b].warn, n[a].warn]; return n; });
  }

  const stage = step === 0
    ? (kind === "images" && slots[0].url ? <img className="cb-pdf-image" src={slots[0].url} alt="Votre dos" /> : CB.image ? <img className="cb-pdf-image" src={CB.image} alt="" /> : null)
    : <StageMockup choice={pack} back={backUrl} cards={cards} media={media} />;

  return (
    <div className={`cb-container studio cb-pdf${status ? " has-status" : ""}`}>
      <div className="stage-col">{stage}</div>
      <div className="panel" ref={panelRef}>
        {header}
        {status ?? (
          <>
            <StepBar step={step} go={(i) => setStep(i > 0 && !ready ? 0 : i)} busy={busy} steps={[
              { label: "Vos fichiers", note: kind === "pdf" ? (file ? "PDF prêt" : undefined) : `${filled}/${slots.length}` },
              { label: "L'étui", note: packOffer(pack.pack)?.label.replace("Étui à fenêtre Carte Blanche", "Fenêtre").replace("Sous film rétractable", "Sous film").replace("Étui personnalisé", "Perso") },
              { label: "Récap" },
            ]} />

            {step === 0 && (
              <div className="step">
                <div className="cb-kit">
                  <div>
                    <b>Kit de création</b>
                    <p className="hint">Gabarits au format exact ({mm(pw)} × {mm(ph)} mm, fond perdu compris), une page par carte dans le bon ordre, fiche technique et mode d&apos;emploi Canva.</p>
                    {free && (
                      <label className="cb-kit-cards">Nombre de cartes
                        <input type="number" min={sp.cardsMin!} max={sp.cardsMax!} value={kitCards}
                          onChange={(e) => setKitCards(Math.max(sp.cardsMin!, Math.min(sp.cardsMax!, Number(e.target.value) || sp.cardsMin!)))} />
                      </label>
                    )}
                  </div>
                  <a className="btn ghost small" href={kit()}>Télécharger le kit</a>
                  <p className="cb-kit-links">
                    <a href={kit("gabarit-jeu.pdf")}>Gabarit PDF ({pages} pages)</a> · <a href={kit("gabarit-carte.png")}>Carte PNG</a> · <a href={kit("gabarit-carte.svg")}>SVG</a> · <a href={kit("fiche-technique.pdf")}>Fiche technique</a>
                  </p>
                </div>

                <div className="seg" role="radiogroup" aria-label="Type de fichiers">
                  <button type="button" role="radio" aria-checked={kind === "pdf"} onClick={() => setKind("pdf")}>Un PDF</button>
                  <button type="button" role="radio" aria-checked={kind === "images"} onClick={() => setKind("images")} disabled={free}
                    title={free ? "Pour un oracle en images, choisissez « Créer en ligne »" : undefined}>Une image par carte</button>
                </div>

                {kind === "pdf" ? (
                  <>
                    <label className={`cb-drop${file ? " on" : ""}`} onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
                      <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                      {file ? <><b>{file.name}</b><span>{(file.size / 1048576).toFixed(1).replace(".", ",")} Mo · cliquez pour changer</span></>
                        : <><b>Choisir mon PDF</b><span>ou le glisser ici</span></>}
                    </label>
                    <p className="hint">{free ? `De ${sp.cardsMin} à ${sp.cardsMax} cartes : ` : `${pages} pages : `}{sp.backs === "individual" ? "face, dos, face, dos…" : "le dos en page 1, puis les faces dans l'ordre du gabarit"}. Pas de traits de coupe ; s&apos;il en reste, nous les retirons.</p>
                  </>
                ) : (
                  <>
                    <label className="cb-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addImages([...e.dataTransfer.files]); }}>
                      <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { addImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
                      <b>Ajouter mes images</b><span>toutes d&apos;un coup : rangées d&apos;après leur nom (« dos », « as-pique », « 10-coeur »…) ou dans l&apos;ordre</span>
                    </label>
                    <div className="cb-slots-head"><b>{filled} / {slots.length} cartes</b>{filled > 0 && <button type="button" className="link" onClick={() => setSlots(initial)}>Tout retirer</button>}</div>
                    <div className="cb-slots">
                      {slots.map((s, i) => (
                        <button type="button" key={s.key} className={`cb-slot${s.file ? " on" : ""}${s.warn ? " warn" : ""}`} title={s.warn || s.label}
                          draggable={!!s.file} onDragStart={() => setDragFrom(i)} onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) swap(dragFrom, i); else if (e.dataTransfer.files.length) addImages([...e.dataTransfer.files]); setDragFrom(null); }}
                          onClick={() => { replaceAt.current = i; oneInput.current?.click(); }}>
                          {s.url ? <img src={s.url} alt="" /> : <i>＋</i>}
                          <span>{s.label}</span>
                          {s.warn && <em>!</em>}
                        </button>
                      ))}
                    </div>
                    {slots.some((s) => s.warn) && <p className="hint">« ! » : {slots.find((s) => s.warn)!.label}, {slots.find((s) => s.warn)!.warn}. Glissez une vignette sur une autre pour les échanger ; cliquez pour remplacer.</p>}
                    <input ref={oneInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setSlots((all) => all.map((s, j) => (j === replaceAt.current ? { ...s, file: f, url: URL.createObjectURL(f), warn: undefined } : s))); }} />
                  </>
                )}
              </div>
            )}

            {step === 1 && <PackStep choice={pack} set={setPack} back={backUrl} cards={cards} media={media} />}

            {step === 2 && (
              <Recap cards={cards} pack={pack.pack} media={media} setMedia={setMedia} qty={qty} setQty={setQty}
                visual={<img src={backUrl} alt="" />}
                lines={[
                  ["Fichiers", kind === "pdf" ? `${file?.name ?? "—"}` : `${filled} images`],
                  ["Format", `${format().label}${free ? "" : ` · ${sp.cards} cartes`}`],
                  ["Étui", packOffer(pack.pack)?.label ?? "—"],
                ]}>
                <p className="hint">Nous contrôlons vos fichiers (pages, format, fond perdu) et vous montrons tout le jeu, carte par carte, avant l&apos;ajout au panier.</p>
              </Recap>
            )}

            <ActionBar position={`${step + 1}/3`} price={{ ...estimate(cards, media, pack.pack, step === 2 ? qty : 1), qty: step === 2 ? qty : 1 }}
              back={step > 0 ? () => setStep(step - 1) : undefined}
              next={step < 2 ? () => setStep(step + 1) : () => onSend(kind === "pdf" ? { kind: "pdf", file: file! } : { kind: "images", slots })}
              nextLabel={["L'étui →", "Récapitulatif →", "Envoyer et contrôler"][step]}
              disabled={busy || (step === 0 || step === 2 ? !ready : false) || (step === 2 && needsBoxFile(pack))}
              hint={!ready ? need : needsBoxFile(pack) ? "Ajoutez le PDF de votre étui (étape L'étui)" : undefined} />
          </>
        )}
      </div>
    </div>
  );
}
