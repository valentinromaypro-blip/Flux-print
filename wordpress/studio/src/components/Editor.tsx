"use client";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Crop, RANKS, SUITS, uid, revealPanel } from "@/lib/design.ts";
import { cutError, cutHead, warmup } from "@/lib/headcut.ts";
import { type Style, RATIO } from "@/lib/cardrender.ts";
import { deckCodes, drawCard, dragBox, MODELS, type Model, startCrop, STYLES } from "@/lib/recto.ts";
import { backModels, type BackModel } from "@/lib/backs.ts";
import { CB } from "@/lib/env.ts";
import BackStep, { BackPreview, type BackState, hasAlpha, initialBack } from "@/components/BackStep";

// Studio de création : grand aperçu à gauche (dessiné comme le moteur l'imprimera), étapes à droite.
// 1. Le dos · 2. Les visages (photos détourées, glissées sur les figures) · 3. Finitions et commande.

type Photo = { id: string; url: string; src: string; path: string | null; cut: boolean; busy: boolean; error?: string };
type Assign = { face: string; crop: Crop };
/** Ce que le studio remet pour fabriquer les cartes à imprimer. */
export type StudioPayload = {
  back: BackState; model: BackModel; style: Style; recto: Model;
  courts: { code: string; face: { url: string; cut: boolean; src: string }; crop: Crop }[];
};
type Props = {
  busy: boolean; header: ReactNode; finish: ReactNode; status: ReactNode;
  onSubmit: (payload: StudioPayload) => void;
};

const COURTS = SUITS.flatMap(([s]) => [...RANKS].reverse().map(([r]) => `${s}-${r}`)); // R, D, V de chaque couleur
const CENTER: Crop = { zoom: 1, x: 0.5, y: 0.5 };
const STEPS = ["Le dos", "Les visages", "Finitions"];
const DECK = deckCodes(CB.deck);
const PEEK = ["S-A", "H-7", "D-10", "JK-1"]; // quelques cartes non figures, pour voir le jeu entier
const label = (code: string) => {
  const [s, r] = code.split("-");
  return `${RANKS.find(([k]) => k === r)![2]} de ${SUITS.find(([k]) => k === s)![2]}`;
};
const glyph = (code: string) => {
  const [s, r] = code.split("-");
  return `${RANKS.find(([k]) => k === r)![1]}${SUITS.find(([k]) => k === s)![1]}`;
};


/** Petite carte dessinée dans le modèle choisi. */
function CardView({ recto, code, face, crop, style, width = 192, sample = false }: { recto: Model; code: string; face: Photo | null; crop: Crop; style: Style; width?: number; sample?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawCard(ref.current, recto, code, face, crop, style, sample).catch(() => {}); }, [recto, code, face, crop, style, sample]);
  return <canvas ref={ref} width={width} height={Math.round(width * RATIO)} />;
}

function MiniCourt({ recto, code, face, crop, style, selected, onSelect, onDropFace, onDropFiles }: {
  recto: Model; code: string; face: Photo | null; crop: Crop; style: Style; selected: boolean;
  onSelect: () => void; onDropFace: (id: string) => void; onDropFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button className={`mini${selected ? " on" : ""}${over ? " over" : ""}`} onClick={onSelect} aria-pressed={selected}
      aria-label={`${label(code)}${face ? " · personnalisée" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const id = e.dataTransfer.getData("text/x-face");
        if (id) onDropFace(id); else if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files]);
      }}>
      <CardView recto={recto} code={code} face={face} crop={crop} style={style} />
      <span className="tag">{glyph(code)}{face && <i aria-hidden>●</i>}</span>
    </button>
  );
}

export default function Editor({ busy, header, finish, status, onSubmit }: Props) {
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null), firstStep = useRef(true);
  useEffect(() => revealPanel(panelRef.current, firstStep), [step]);
  useEffect(() => { if (step === 1) warmup(); }, [step]);
  const [back, setBackState] = useState<BackState>(initialBack);
  const [models, setModels] = useState<BackModel[]>([]);
  const setBack = (patch: Partial<BackState>) => setBackState((b) => ({ ...b, ...patch }));
  const backDrag = useRef<Crop | null>(null);
  const [faces, setFaces] = useState<Photo[]>([]);
  const [courts, setCourts] = useState<Record<string, Assign>>({});
  const [selected, setSelected] = useState("H-K");
  const [style, setStyle] = useState<Style>("couleur");
  const [recto, setRecto] = useState<Model>("classique");
  const rectoRef = useRef(recto); rectoRef.current = recto;
  const [over, setOver] = useState(false);
  const stage = useRef<HTMLCanvasElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop; w: number; h: number } | null>(null);
  const pendingTarget = useRef<string | null>(null);

  const faceOf = (id?: string) => faces.find((f) => f.id === id) ?? null;
  const current = courts[selected];
  const currentFace = faceOf(current?.face);
  const done = Object.keys(courts).filter((c) => faceOf(courts[c].face)).length;
  const uploading = [back.photo, back.logo, ...faces].some((p) => p?.busy);
  useEffect(() => { backModels().then(setModels).catch(() => {}); }, []);
  const view = step === 0 ? "back" : "court";

  // Grand aperçu
  useEffect(() => {
    const c = stage.current;
    if (!c || view !== "court") return;
    drawCard(c, recto, selected, currentFace, current?.crop ?? CENTER, style).catch(() => {});
  }, [view, selected, currentFace, current, style, recto]);

  // Photos : détourage, envoi, et pose sur la figure visée (la première photo seulement).
  const [cutNote, setCutNote] = useState("");
  const addFaces = useCallback(async (files: File[], target: string | null) => {
    let dest = target;
    for (const file of files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, 12)) {
      const id = uid(), assignTo = dest;
      dest = null;
      const src = URL.createObjectURL(file);
      setFaces((all) => [...all, { id, url: src, src, path: null, cut: false, busy: true }]);
      if (assignTo) { setCourts((all) => ({ ...all, [assignTo]: { face: id, crop: startCrop(rectoRef.current, { url: src, cut: false }) } })); setSelected(assignTo); }
      const cut = await cutHead(file);
      setCutNote(cut ? "" : cutError);
      if (cut) {
        const url = URL.createObjectURL(cut);
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, url, cut: true } : f)));
        if (assignTo) setCourts((all) => (all[assignTo]?.face === id ? { ...all, [assignTo]: { face: id, crop: startCrop(rectoRef.current, { url, cut: true }) } } : all));
      }
      try {
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, path: "local", busy: false } : f)));
      } catch (e) {
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, busy: false, error: (e as Error).message } : f)));
      }
    }
  }, []);

  function assign(code: string, id: string) {
    const f = faceOf(id);
    if (!f || f.error) return;
    setCourts((all) => ({ ...all, [code]: { face: id, crop: startCrop(recto, f) } }));
    setSelected(code);
  }
  function autofill() {
    const usable = faces.filter((f) => !f.error);
    if (!usable.length) return;
    const next = { ...courts };
    COURTS.filter((c) => !next[c]).forEach((c, i) => {
      const f = usable[i % usable.length];
      next[c] = { face: f.id, crop: startCrop(recto, f) };
    });
    setCourts(next);
  }
  /** Changement de modèle : rendu conseillé, et cadrages remis à zéro (ils n'ont pas le même sens). */
  function chooseRecto(m: Model) {
    setRecto(m);
    setStyle(MODELS.find((x) => x.id === m)!.style);
    setCourts((all) => Object.fromEntries(Object.entries(all).map(([code, a]) => {
      const f = faceOf(a.face);
      return [code, f ? { ...a, crop: startCrop(m, f) } : a];
    })));
  }
  function removeFace(id: string) {
    setFaces((all) => all.filter((f) => f.id !== id));
    setCourts((all) => Object.fromEntries(Object.entries(all).filter(([, a]) => a.face !== id)));
  }
  const setCrop = (patch: Partial<Crop>) =>
    setCourts((all) => (all[selected] ? { ...all, [selected]: { ...all[selected], crop: { ...all[selected].crop, ...patch } } } : all));
  const zoomBy = (f: number) => {
    if (!current) return;
    const [lo, hi] = currentFace?.cut && recto !== "portrait" ? [0.5, 2.5] : [1, 4];
    setCrop({ zoom: +Math.min(hi, Math.max(lo, current.crop.zoom * f)).toFixed(3) });
  };

  // Glisser le visage dans le grand aperçu
  async function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (view !== "court" || !current) return;
    const c = e.currentTarget, id = e.pointerId, start = { x: e.clientX, y: e.clientY, crop: current.crop };
    c.setPointerCapture(id);
    const box = await dragBox(recto, selected, c.width), scale = c.getBoundingClientRect().width / c.width;
    drag.current = { ...start, w: box.w * scale, h: box.h * scale };
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w, dy = (e.clientY - d.y) / d.h;
    const clamp = (v: number) => +Math.min(1, Math.max(0, v)).toFixed(3);
    // tête détourée : on déplace la tête ; photo ordinaire : on déplace le cadre dans la photo (sens inverse)
    const k = recto === "portrait" ? -0.8 / d.crop.zoom : currentFace?.cut ? 1 : -0.5 / d.crop.zoom;
    setCrop({ x: clamp(d.crop.x + k * dx), y: clamp(d.crop.y + k * dy) });
  }

  function submit() {
    const model = models.find((m) => m.id === back.template);
    if (!model) return;
    onSubmit({
      back, model, style, recto,
      courts: Object.entries(courts).flatMap(([code, a]) => {
        const f = faceOf(a.face);
        return f && !f.error ? [{ code, face: { url: f.url, cut: f.cut, src: f.src }, crop: a.crop }] : [];
      }),
    });
  }

  async function uploadBack(kind: "logo" | "photo", file: File) {
    const id = uid(), url = URL.createObjectURL(file);
    if (kind === "logo") setBack({ logo: { id, url, path: null, busy: true, alpha: await hasAlpha(url).catch(() => false) } });
    else setBack({ photo: { id, url, path: null, busy: true }, crop: CENTER });
    const update = (patch: object) => setBackState((b) => {
      const cur = b[kind];
      return cur?.id === id ? { ...b, [kind]: { ...cur, ...patch } } : b;
    });
    update({ path: "local", busy: false }); // l'image reste dans le navigateur jusqu'au rendu d'impression
  }
  function dragBack(dx: number, dy: number, done: boolean) {
    if (done) { backDrag.current = null; return; }
    const start = (backDrag.current ??= back.crop);
    const clamp = (v: number) => +Math.min(1, Math.max(0, v)).toFixed(3);
    setBack({ crop: { ...start, x: clamp(start.x - dx / start.zoom), y: clamp(start.y - dy / start.zoom) } });
  }

  return (
    <div className="cb-container studio">
      <div className="stage-col">
        <div className={`stage${over ? " over" : ""}`}
          onDragOver={(e) => { if (view === "court") { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setOver(false);
            const id = e.dataTransfer.getData("text/x-face");
            if (id) assign(selected, id); else addFaces([...e.dataTransfer.files], selected);
          }}>
          {view === "back" && <BackPreview state={back} models={models} onDrag={dragBack} />}
          <canvas ref={stage} width={720} height={Math.round(720 * RATIO)} aria-label={`Aperçu : ${label(selected)}`}
            hidden={view === "back"} className={view === "court" && current ? "grab" : ""}
            onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => { if (view === "court" && current) zoomBy(e.deltaY < 0 ? 1.05 : 1 / 1.05); }} />
          {view === "court" && !current && (
            <button className="stage-empty" onClick={() => { pendingTarget.current = selected; picker.current?.click(); }}>
              <b>＋</b><span>Mettre un visage sur {label(selected).toLowerCase()}</span>
            </button>
          )}
        </div>
        {view === "court" && current && (
          <div className="stage-tools" role="toolbar" aria-label="Ajuster le visage">
            <button onClick={() => zoomBy(1 / 1.1)} aria-label="Réduire">−</button>
            <button onClick={() => zoomBy(1.1)} aria-label="Agrandir">+</button>
            <button onClick={() => currentFace && setCrop(startCrop(recto, currentFace))}>Recentrer</button>
            <button onClick={() => setCourts((all) => { const n = { ...all }; delete n[selected]; return n; })}>Retirer</button>
          </div>
        )}
        <p className="stage-caption">{view === "back"
          ? (models.find((m) => m.id === back.template)?.photo && back.photo ? "Glissez la photo pour la placer · le dos est identique sur toutes les cartes" : `Le dos, identique sur les ${CB.spec.cards} cartes`)
          : current ? "Glissez le visage pour le placer · molette ou −/+ pour la taille" : `${label(selected)} · tête du haut et du bas`}</p>
      </div>

      <div className="panel" ref={panelRef}>
        {header}
        {status ?? (
          <>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s}><button aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)} disabled={busy}>
                  <span>{i + 1}</span>{s}{i === 1 && done > 0 ? ` · ${done}/12` : ""}</button></li>
              ))}
            </ol>

            {step === 0 && (
              <BackStep state={back} set={setBack} models={models} onNext={() => setStep(1)}
                pickLogo={(f) => uploadBack("logo", f)} pickPhoto={(f) => uploadBack("photo", f)} />
            )}

            {step === 1 && (
              <div className="step">
                <div className="field-group">
                  <b>Modèle du recto</b>
                  <div className="cb-models" role="radiogroup" aria-label="Modèle du recto">
                    {MODELS.map((m) => (
                      <button key={m.id} role="radio" aria-checked={recto === m.id} className={recto === m.id ? "on" : ""} onClick={() => chooseRecto(m.id)}>
                        <CardView recto={m.id} code={selected} face={currentFace} sample width={120}
                          crop={m.id === recto ? current?.crop ?? CENTER : currentFace ? startCrop(m.id, currentFace) : CENTER} style={m.id === recto ? style : m.style} />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="hint">{MODELS.find((m) => m.id === recto)!.hint}</p>
                  <div className="cb-deck-peek" aria-label="Le reste du jeu">
                    {PEEK.filter((c) => DECK.includes(c)).map((c) => <CardView key={c} recto={recto} code={c} face={null} crop={CENTER} style={style} width={96} />)}
                  </div>
                </div>
                <div className="tray" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFaces([...e.dataTransfer.files], null); }}>
                  <div className="tray-head">
                    <b>Vos photos</b>
                    <button className="btn ghost small" onClick={() => { pendingTarget.current = null; picker.current?.click(); }}>＋ Ajouter des photos</button>
                  </div>
                  {faces.length === 0 ? (
                    <p className="hint">Une ou plusieurs photos de face, une personne par photo : la tête est détourée automatiquement. Glissez ensuite chaque visage sur une figure.</p>
                  ) : (
                    <div className="faces">
                      {faces.map((f) => (
                        <div key={f.id} className={`face${f.busy ? " busy" : ""}${f.error ? " err" : ""}`} draggable={!f.error}
                          onDragStart={(e) => e.dataTransfer.setData("text/x-face", f.id)} title={f.error ?? "Glissez sur une figure, ou cliquez pour la figure affichée"}>
                          <button onClick={() => assign(selected, f.id)} aria-label="Mettre ce visage sur la figure affichée"><img src={f.url} alt="" /></button>
                          {f.busy && <span className="spinner" />}
                          <button className="x" onClick={() => removeFace(f.id)} aria-label="Supprimer cette photo">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {faces.some((f) => f.error) && <p className="error-text">{faces.find((f) => f.error)!.error}</p>}
                  {cutNote && <p className="hint">Photo non détourée : {cutNote}. Le visage est placé dans un médaillon ; essayez une photo de face, bien éclairée.</p>}
                </div>

                <div className="field-group">
                  <div className="tray-head">
                    <b>Les 12 figures <span className="hint">· {done} personnalisée{done > 1 ? "s" : ""}</span></b>
                    {faces.length > 0 && done < 12 && <button className="link" onClick={autofill}>Remplir les figures vides</button>}
                  </div>
                  <div className="court-grid">
                    {COURTS.map((code) => (
                      <MiniCourt key={code} recto={recto} code={code} face={faceOf(courts[code]?.face)} crop={courts[code]?.crop ?? CENTER} style={style}
                        selected={code === selected} onSelect={() => setSelected(code)}
                        onDropFace={(id) => assign(code, id)} onDropFiles={(files) => addFaces(files, code)} />
                    ))}
                  </div>
                </div>

                <div className="field-group">
                  <b>Rendu des visages</b>
                  <div className="seg" role="radiogroup" aria-label="Rendu des visages">
                    {STYLES.map(([v, name]) => (
                      <button key={v} role="radio" aria-checked={style === v} onClick={() => setStyle(v)}>{name}</button>
                    ))}
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn red" onClick={() => setStep(2)}>Continuer : finitions →</button>
                  <button className="link" onClick={() => setStep(0)}>← Le dos</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="step">
                {finish}
                <button className="btn red wide" disabled={busy || uploading} onClick={submit}>
                  {uploading ? "Envoi des photos…" : "Valider mon jeu"}
                </button>
                <p className="hint">Nous fabriquons vos {CB.spec.cards} cartes en qualité d&apos;impression et vous montrons le rendu final avant l&apos;ajout au panier.</p>
                <button className="link" onClick={() => setStep(1)}>← Les visages</button>
              </div>
            )}
          </>
        )}
      </div>
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; addFaces(files, pendingTarget.current); pendingTarget.current = null; }} />
    </div>
  );
}
