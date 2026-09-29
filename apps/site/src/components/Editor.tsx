"use client";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Crop, type Design, RANKS, SUITS } from "@/lib/design.ts";
import { cutHead } from "@/lib/headcut.ts";
import { type Back, type Style, drawBack, drawCourt, headBox, RATIO } from "@/lib/cardrender.ts";

// Studio de création : grand aperçu à gauche (dessiné comme le moteur l'imprimera), étapes à droite.
// 1. Le dos · 2. Les visages (photos détourées, glissées sur les figures) · 3. Finitions et commande.

type Photo = { id: string; url: string; path: string | null; cut: boolean; busy: boolean; error?: string };
type Assign = { face: string; crop: Crop };
type Props = {
  product: string; busy: boolean; header: ReactNode; finish: ReactNode; status: ReactNode;
  onSubmit: (design: Design) => void;
};

const COLORS: [string, string, string][] = [
  ["Vert tapis", "#134536", "#F0E8D6"], ["Nuit", "#1C2440", "#E8D6B0"], ["Noir", "#16161A", "#E6E4DE"],
  ["Rouge", "#B3152A", "#FCEFE6"], ["Crème", "#F3EBDD", "#9C7A3C"], ["Rose", "#EEC4C8", "#78203C"],
];
const COURTS = SUITS.flatMap(([s]) => [...RANKS].reverse().map(([r]) => `${s}-${r}`)); // R, D, V de chaque couleur
const CENTER: Crop = { zoom: 1, x: 0.5, y: 0.5 };
const OVAL: Crop = { zoom: 2.2, x: 0.5, y: 0.38 }; // photo non détourée : cadrage de départ sur le visage
const STEPS = ["Le dos", "Les visages", "Finitions"];
const label = (code: string) => {
  const [s, r] = code.split("-");
  return `${RANKS.find(([k]) => k === r)![2]} de ${SUITS.find(([k]) => k === s)![2]}`;
};
const glyph = (code: string) => {
  const [s, r] = code.split("-");
  return `${RANKS.find(([k]) => k === r)![1]}${SUITS.find(([k]) => k === s)![1]}`;
};

async function uploadPhoto(product: string, file: Blob): Promise<string> {
  const res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, size: file.size, kind: "photo", type: file.type }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error);
  const put = await fetch(out.target.url, { method: out.target.method, headers: out.target.headers, body: file });
  if (!put.ok) throw new Error("L'envoi de la photo a échoué.");
  return out.path as string;
}

function MiniCourt({ code, face, crop, style, selected, onSelect, onDropFace, onDropFiles }: {
  code: string; face: Photo | null; crop: Crop; style: Style; selected: boolean;
  onSelect: () => void; onDropFace: (id: string) => void; onDropFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => { if (ref.current) drawCourt(ref.current, code, face, crop, style).catch(() => {}); }, [code, face, crop, style]);
  return (
    <button className={`mini${selected ? " on" : ""}${over ? " over" : ""}`} onClick={onSelect} aria-pressed={selected}
      aria-label={`${label(code)}${face ? " · personnalisée" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const id = e.dataTransfer.getData("text/x-face");
        if (id) onDropFace(id); else if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files]);
      }}>
      <canvas ref={ref} width={192} height={Math.round(192 * RATIO)} />
      <span className="tag">{glyph(code)}{face && <i aria-hidden>●</i>}</span>
    </button>
  );
}

export default function Editor({ product, busy, header, finish, status, onSubmit }: Props) {
  const [step, setStep] = useState(0);
  const [back, setBack] = useState<Back>({ color: "#134536", ink: "#F0E8D6", title: "", subtitle: "" });
  const [backPhoto, setBackPhoto] = useState<Photo | null>(null);
  const [backCrop, setBackCrop] = useState<Crop>(CENTER);
  const [faces, setFaces] = useState<Photo[]>([]);
  const [courts, setCourts] = useState<Record<string, Assign>>({});
  const [selected, setSelected] = useState("H-K");
  const [style, setStyle] = useState<Style>("couleur");
  const [over, setOver] = useState(false);
  const stage = useRef<HTMLCanvasElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const backPicker = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop; w: number; h: number } | null>(null);
  const pendingTarget = useRef<string | null>(null);

  const faceOf = (id?: string) => faces.find((f) => f.id === id) ?? null;
  const current = courts[selected];
  const currentFace = faceOf(current?.face);
  const done = Object.keys(courts).filter((c) => faceOf(courts[c].face)).length;
  const uploading = [backPhoto, ...faces].some((p) => p?.busy);
  const view = step === 0 ? "back" : "court";

  // Grand aperçu
  useEffect(() => {
    const c = stage.current;
    if (!c) return;
    const job = view === "back" ? drawBack(c, back, backPhoto, backCrop) : drawCourt(c, selected, currentFace, current?.crop ?? CENTER, style);
    job.catch(() => {});
  }, [view, back, backPhoto, backCrop, selected, currentFace, current, style]);

  // Photos : détourage, envoi, et pose sur la figure visée (la première photo seulement).
  const addFaces = useCallback(async (files: File[], target: string | null) => {
    let dest = target;
    for (const file of files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, 12)) {
      const id = crypto.randomUUID(), assignTo = dest;
      dest = null;
      setFaces((all) => [...all, { id, url: URL.createObjectURL(file), path: null, cut: false, busy: true }]);
      if (assignTo) { setCourts((all) => ({ ...all, [assignTo]: { face: id, crop: OVAL } })); setSelected(assignTo); }
      const cut = await cutHead(file);
      if (cut) {
        const url = URL.createObjectURL(cut);
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, url, cut: true } : f)));
        if (assignTo) setCourts((all) => (all[assignTo]?.face === id ? { ...all, [assignTo]: { face: id, crop: CENTER } } : all));
      }
      try {
        const path = await uploadPhoto(product, cut ?? file);
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, path, busy: false } : f)));
      } catch (e) {
        setFaces((all) => all.map((f) => (f.id === id ? { ...f, busy: false, error: (e as Error).message } : f)));
      }
    }
  }, [product]);

  function assign(code: string, id: string) {
    const f = faceOf(id);
    if (!f || f.error) return;
    setCourts((all) => ({ ...all, [code]: { face: id, crop: f.cut ? CENTER : OVAL } }));
    setSelected(code);
  }
  function autofill() {
    const usable = faces.filter((f) => !f.error);
    if (!usable.length) return;
    const next = { ...courts };
    COURTS.filter((c) => !next[c]).forEach((c, i) => {
      const f = usable[i % usable.length];
      next[c] = { face: f.id, crop: f.cut ? CENTER : OVAL };
    });
    setCourts(next);
  }
  function removeFace(id: string) {
    setFaces((all) => all.filter((f) => f.id !== id));
    setCourts((all) => Object.fromEntries(Object.entries(all).filter(([, a]) => a.face !== id)));
  }
  const setCrop = (patch: Partial<Crop>) =>
    setCourts((all) => (all[selected] ? { ...all, [selected]: { ...all[selected], crop: { ...all[selected].crop, ...patch } } } : all));
  const zoomBy = (f: number) => {
    if (!current) return;
    const [lo, hi] = currentFace?.cut ? [0.5, 2.5] : [1, 4];
    setCrop({ zoom: +Math.min(hi, Math.max(lo, current.crop.zoom * f)).toFixed(3) });
  };

  // Glisser le visage dans le grand aperçu
  async function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (view !== "court" || !current) return;
    const c = e.currentTarget, id = e.pointerId, start = { x: e.clientX, y: e.clientY, crop: current.crop };
    c.setPointerCapture(id);
    const box = await headBox(selected, c.width), scale = c.getBoundingClientRect().width / c.width;
    drag.current = { ...start, w: box.w * scale, h: box.h * scale };
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w, dy = (e.clientY - d.y) / d.h;
    const clamp = (v: number) => +Math.min(1, Math.max(0, v)).toFixed(3);
    // tête détourée : on déplace la tête ; photo ordinaire : on déplace le cadre dans la photo (sens inverse)
    const k = currentFace?.cut ? 1 : -0.5 / d.crop.zoom;
    setCrop({ x: clamp(d.crop.x + k * dx), y: clamp(d.crop.y + k * dy) });
  }

  function submit() {
    const ref = (p: Photo | null, crop: Crop) => (p?.path ? { path: p.path, ...crop } : null);
    onSubmit({
      back: { ...back, photo: ref(backPhoto, backCrop) },
      style,
      courts: Object.fromEntries(Object.entries(courts).flatMap(([code, a]) => {
        const p = ref(faceOf(a.face), a.crop);
        return p ? [[code, { photo: p }]] : [];
      })),
    });
  }

  async function pickBack(file: File) {
    const id = crypto.randomUUID();
    setBackPhoto({ id, url: URL.createObjectURL(file), path: null, cut: false, busy: true });
    setBackCrop(CENTER);
    try {
      const path = await uploadPhoto(product, file);
      setBackPhoto((p) => (p?.id === id ? { ...p, path, busy: false } : p));
    } catch (e) {
      setBackPhoto((p) => (p?.id === id ? { ...p, busy: false, error: (e as Error).message } : p));
    }
  }

  return (
    <div className="container studio">
      <div className="stage-col">
        <div className={`stage${over ? " over" : ""}`}
          onDragOver={(e) => { if (view === "court") { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setOver(false);
            const id = e.dataTransfer.getData("text/x-face");
            if (id) assign(selected, id); else addFaces([...e.dataTransfer.files], selected);
          }}>
          <canvas ref={stage} width={720} height={Math.round(720 * RATIO)} aria-label={view === "back" ? "Aperçu du dos" : `Aperçu : ${label(selected)}`}
            className={view === "court" && current ? "grab" : ""}
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
            <button onClick={() => setCrop(currentFace?.cut ? CENTER : OVAL)}>Recentrer</button>
            <button onClick={() => setCourts((all) => { const n = { ...all }; delete n[selected]; return n; })}>Retirer</button>
          </div>
        )}
        <p className="stage-caption">{view === "back"
          ? "Le dos, identique sur les 55 cartes"
          : current ? "Glissez le visage pour le placer · molette ou −/+ pour la taille" : `${label(selected)} · tête du haut et du bas`}</p>
      </div>

      <div className="panel">
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
              <div className="step">
                <div className="field-group">
                  <b>Couleur</b>
                  <div className="swatches">
                    {COLORS.map(([name, color, ink]) => (
                      <button key={name} title={name} aria-label={name} aria-pressed={back.color === color}
                        style={{ background: color, color: ink }} onClick={() => setBack({ ...back, color, ink })}>Aa</button>
                    ))}
                  </div>
                </div>
                <div className="grid2">
                  <label className="field">Texte principal<input maxLength={12} value={back.title} placeholder="J & M" onChange={(e) => setBack({ ...back, title: e.target.value })} /></label>
                  <label className="field">Texte secondaire<input maxLength={24} value={back.subtitle} placeholder="12 · 06 · 2027" onChange={(e) => setBack({ ...back, subtitle: e.target.value })} /></label>
                </div>
                <div className="field-group">
                  <b>Photo de fond <span className="hint">(facultatif)</span></b>
                  <div className="row-actions">
                    <button className="btn ghost small" onClick={() => backPicker.current?.click()}>{backPhoto ? "Changer la photo" : "＋ Ajouter une photo"}</button>
                    {backPhoto && <button className="link" onClick={() => setBackPhoto(null)}>Retirer</button>}
                    {backPhoto?.busy && <span className="hint"><span className="spinner" />Envoi…</span>}
                    {backPhoto?.error && <span className="error-text">{backPhoto.error}</span>}
                  </div>
                  {backPhoto && (
                    <label className="field">Zoom<input type="range" min={1} max={3} step={0.02} value={backCrop.zoom} onChange={(e) => setBackCrop({ ...backCrop, zoom: +e.target.value })} /></label>
                  )}
                  <input ref={backPicker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickBack(f); }} />
                </div>
                <button className="btn red wide" onClick={() => setStep(1)}>Continuer : les visages →</button>
              </div>
            )}

            {step === 1 && (
              <div className="step">
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
                </div>

                <div className="field-group">
                  <div className="tray-head">
                    <b>Les 12 figures <span className="hint">· {done} personnalisée{done > 1 ? "s" : ""}</span></b>
                    {faces.length > 0 && done < 12 && <button className="link" onClick={autofill}>Remplir les figures vides</button>}
                  </div>
                  <div className="court-grid">
                    {COURTS.map((code) => (
                      <MiniCourt key={code} code={code} face={faceOf(courts[code]?.face)} crop={courts[code]?.crop ?? CENTER} style={style}
                        selected={code === selected} onSelect={() => setSelected(code)}
                        onDropFace={(id) => assign(code, id)} onDropFiles={(files) => addFaces(files, code)} />
                    ))}
                  </div>
                </div>

                <div className="field-group">
                  <b>Rendu des visages</b>
                  <div className="seg" role="radiogroup" aria-label="Rendu des visages">
                    {(["couleur", "gravure"] as const).map((v) => (
                      <button key={v} role="radio" aria-checked={style === v} onClick={() => setStyle(v)}>{v === "couleur" ? "Photo couleur" : "Gravure bleue"}</button>
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
                <p className="hint">Nous fabriquons les 55 cartes en qualité d&apos;impression et vous montrons le rendu final avant l&apos;ajout au panier.</p>
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
