import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Crop, uid, revealPanel } from "@/lib/design.ts";
import { backModels, type BackModel } from "@/lib/backs.ts";
import { CB } from "@/lib/env.ts";
import { format } from "@/lib/format.ts";
import { type CardLook, drawFreeCard, type FreeCard } from "@/lib/print.ts";
import BackStep, { BackPreview, type BackState, hasAlpha, initialBack } from "@/components/BackStep";
import PackStep, { StageMockup, needsBoxFile, type PackChoice, PackSummary, useBackImage } from "@/components/PackStep";

// Studio des jeux « cartes libres » (oracle) : un dos commun, puis une image par carte, avec un
// titre facultatif. Même disposition que le studio des jeux classiques : aperçu à gauche, étapes à droite.

export type Card = FreeCard & { id: string };
export type CardsPayload = { back: BackState; model: BackModel; cards: Card[]; look: CardLook };
type Props = {
  busy: boolean; header: ReactNode; finish: ReactNode; status: ReactNode; onSubmit: (p: CardsPayload) => void;
  pack: PackChoice; setPack: (patch: Partial<PackChoice>) => void; media: string;
};

const CENTER: Crop = { zoom: 1, x: 0.5, y: 0.5 };
const STEPS = ["Le dos", "Vos cartes", "L'étui", "Finitions"];
const clamp01 = (v: number) => +Math.min(1, Math.max(0, v)).toFixed(3);

/** Fraction de la page occupée par le fond perdu, en largeur et en hauteur. */
function bleedFrac(): [number, number] {
  const f = format();
  return [CB.bleedMm / f.page[0], CB.bleedMm / f.page[1]];
}

function CardCanvas({ card, look, width, className, onPointerDown, onPointerMove, onPointerUp }: {
  card: FreeCard; look: CardLook; width: number; className?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void; onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void; onPointerUp?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, h] = format().page;
  useEffect(() => { if (ref.current) drawFreeCard(ref.current, card, look, bleedFrac()).catch(() => {}); }, [card, look]);
  return <canvas ref={ref} width={width} height={Math.round((width * h) / w)} className={className}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />;
}

export default function CardsEditor({ busy, header, finish, status, onSubmit, pack, setPack, media }: Props) {
  const min = CB.spec.cardsMin ?? 1, max = CB.spec.cardsMax ?? 100;
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null), firstStep = useRef(true);
  useEffect(() => revealPanel(panelRef.current, firstStep), [step]);
  const [models, setModels] = useState<BackModel[]>([]);
  const [back, setBackState] = useState<BackState>(initialBack);
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [look, setLook] = useState<Omit<CardLook, "bg" | "ink">>({ frame: false, band: true });
  const picker = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; w: number; h: number; crop: Crop } | null>(null);
  const backDrag = useRef<Crop | null>(null);

  useEffect(() => { backModels().then(setModels).catch(() => {}); }, []);
  const setBack = useCallback((patch: Partial<BackState>) => setBackState((b) => ({ ...b, ...patch })), []);
  const fullLook: CardLook = { ...look, bg: back.bg, ink: back.ink };
  const current = cards.find((c) => c.id === selected) ?? null;
  const backImage = useBackImage(back, models.find((m) => m.id === back.template), step >= 2);
  const deckSize = Math.max(min, cards.length);
  const index = current ? cards.indexOf(current) : -1;

  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/")).slice(0, max - cards.length);
    if (!images.length) return;
    const added = images.map((f) => ({ id: uid(), url: URL.createObjectURL(f), crop: CENTER, title: "" }));
    setCards((all) => [...all, ...added]);
    setSelected((s) => s ?? added[0].id);
  }
  const update = (id: string, patch: Partial<Card>) => setCards((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  function move(delta: number) {
    if (index < 0) return;
    const to = index + delta;
    if (to < 0 || to >= cards.length) return;
    setCards((all) => { const n = [...all]; [n[index], n[to]] = [n[to], n[index]]; return n; });
  }
  function remove(id: string) {
    setCards((all) => all.filter((c) => c.id !== id));
    setSelected((s) => (s === id ? null : s));
  }

  async function uploadBack(kind: "logo" | "photo", file: File) {
    const id = uid(), url = URL.createObjectURL(file);
    if (kind === "logo") setBack({ logo: { id, url, path: "local", busy: false, alpha: await hasAlpha(url).catch(() => false) } });
    else setBack({ photo: { id, url, path: "local", busy: false }, crop: CENTER });
  }
  function dragBack(dx: number, dy: number, done: boolean) {
    if (done) { backDrag.current = null; return; }
    const start = (backDrag.current ??= back.crop);
    setBack({ crop: { ...start, x: clamp01(start.x - dx / start.zoom), y: clamp01(start.y - dy / start.zoom) } });
  }

  function submit() {
    const model = models.find((m) => m.id === back.template);
    if (model && cards.length >= min) onSubmit({ back, model, cards, look: fullLook });
  }

  const count = `${cards.length} carte${cards.length > 1 ? "s" : ""}`;
  return (
    <div className="cb-container studio">
      <div className="stage-col">
        <div className="stage" onDragOver={(e) => { if (step === 1) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
          {step === 2 ? <StageMockup choice={pack} back={backImage} cards={deckSize} media={media} />
          : step === 0 || !current
            ? (step === 0 || !cards.length
              ? <BackPreview state={back} models={models} onDrag={dragBack} />
              : <button className="stage-empty" onClick={() => picker.current?.click()}><b>＋</b><span>Ajouter vos images</span></button>)
            : <CardCanvas card={current} look={fullLook} width={720} className="grab"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, crop: current.crop }; }}
                onPointerMove={(e) => { const d = drag.current; if (!d) return; const k = -1 / d.crop.zoom;
                  update(current.id, { crop: { ...d.crop, x: clamp01(d.crop.x + (k * (e.clientX - d.x)) / d.w), y: clamp01(d.crop.y + (k * (e.clientY - d.y)) / d.h) } }); }}
                onPointerUp={() => (drag.current = null)} />}
        </div>
        {step > 0 && current && (
          <div className="stage-tools" role="toolbar" aria-label="Ajuster l'image">
            <button onClick={() => update(current.id, { crop: { ...current.crop, zoom: Math.max(1, +(current.crop.zoom / 1.1).toFixed(3)) } })} aria-label="Réduire">−</button>
            <button onClick={() => update(current.id, { crop: { ...current.crop, zoom: Math.min(4, +(current.crop.zoom * 1.1).toFixed(3)) } })} aria-label="Agrandir">+</button>
            <button onClick={() => update(current.id, { crop: CENTER })}>Recentrer</button>
            <button onClick={() => move(-1)} disabled={index <= 0} aria-label="Avancer la carte">←</button>
            <button onClick={() => move(1)} disabled={index >= cards.length - 1} aria-label="Reculer la carte">→</button>
            <button onClick={() => remove(current.id)}>Retirer</button>
          </div>
        )}
        <p className="stage-caption">{step === 2 ? "Votre jeu tel que vous le recevrez" : step === 0 ? `Le dos, identique sur toutes les cartes · ${format().label}`
          : current ? `Carte ${index + 1} sur ${cards.length} · glissez l'image pour la placer` : `${format().label} · de ${min} à ${max} cartes`}</p>
      </div>

      <div className="panel" ref={panelRef}>
        {header}
        {status ?? (
          <>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s}><button aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)} disabled={busy}>
                  <span>{i + 1}</span>{s}{i === 1 && cards.length ? ` · ${cards.length}` : ""}</button></li>
              ))}
            </ol>

            {step === 0 && <BackStep state={back} set={setBack} models={models} onNext={() => setStep(1)}
              pickLogo={(f) => uploadBack("logo", f)} pickPhoto={(f) => uploadBack("photo", f)} />}

            {step === 1 && (
              <div className="step">
                <div className="tray" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
                  <div className="tray-head">
                    <b>Vos cartes <span className="hint">· {count} (de {min} à {max})</span></b>
                    <button className="btn ghost small" onClick={() => picker.current?.click()} disabled={cards.length >= max}>＋ Ajouter des images</button>
                  </div>
                  {cards.length === 0
                    ? <p className="hint">Une image par carte, dans l&apos;ordre du jeu. Sélectionnez-les toutes d&apos;un coup : chaque image devient une carte, que vous pouvez recadrer, titrer et réordonner.</p>
                    : (
                      <div className="cb-cards">
                        {cards.map((c, i) => (
                          <button key={c.id} className={`cb-card${c.id === selected ? " on" : ""}`} onClick={() => setSelected(c.id)} aria-label={`Carte ${i + 1}`}>
                            <CardCanvas card={c} look={fullLook} width={120} />
                            <span>{i + 1}</span>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
                {current && (
                  <label className="field">Titre de la carte {index + 1} <span className="hint">(facultatif)</span>
                    <input maxLength={40} value={current.title} placeholder="La Lune" onChange={(e) => update(current.id, { title: e.target.value })} />
                  </label>
                )}
                <div className="field-group">
                  <b>Présentation</b>
                  <label className="check-row"><input type="checkbox" checked={look.band} onChange={(e) => setLook((l) => ({ ...l, band: e.target.checked }))} /> Titre en bas de la carte, dans les couleurs du dos</label>
                  <label className="check-row"><input type="checkbox" checked={look.frame} onChange={(e) => setLook((l) => ({ ...l, frame: e.target.checked }))} /> Filet autour de l&apos;image</label>
                </div>
                <div className="row-actions">
                  <button className="btn red" onClick={() => setStep(2)} disabled={cards.length < min}>
                    {cards.length < min ? `Encore ${min - cards.length} carte${min - cards.length > 1 ? "s" : ""}` : "Continuer : l'étui →"}
                  </button>
                  <button className="link" onClick={() => setStep(0)}>← Le dos</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <PackStep choice={pack} set={setPack} back={backImage} cards={deckSize} media={media}
                defaults={{ bg: back.bg, ink: back.ink, title: back.title, subtitle: back.subtitle }}
                nav={<div className="row-actions">
                  <button className="btn red" onClick={() => setStep(3)}>Continuer : finitions →</button>
                  <button className="link" onClick={() => setStep(1)}>← Vos cartes</button>
                </div>} />
            )}

            {step === 3 && (
              <div className="step">
                {finish}
                <PackSummary choice={pack} />
                <p className="hint">{count} au format {format().label}. Les images doivent couvrir toute la carte : ce qui dépasse du trait de coupe (3 mm) disparaît au massicot, gardez l&apos;essentiel loin des bords.</p>
                <button className="btn red wide" disabled={busy || cards.length < min || needsBoxFile(pack)} onClick={submit}>
                  {needsBoxFile(pack) ? "Ajoutez le PDF de votre étui" : "Valider mon jeu"}</button>
                <button className="link" onClick={() => setStep(2)}>← L&apos;étui</button>
              </div>
            )}
          </>
        )}
      </div>
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}
