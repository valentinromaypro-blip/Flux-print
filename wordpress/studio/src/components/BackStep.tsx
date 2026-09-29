"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Crop } from "@/lib/design.ts";
import { backRatio } from "@/lib/format.ts";
import { backFields, backModels, backTemplate, fillBack, SUBTITLE_MAX, TITLE_MAX, type BackModel } from "@/lib/backs.ts";

// Étape « Le dos » du studio : galerie de modèles (aperçus vivants avec le texte et le logo du client),
// couleurs libres (charte d'entreprise), logo, photo. Le dessin est le même SVG que celui imprimé.

export type Upload = { id: string; url: string; path: string | null; busy: boolean; error?: string };
export type BackState = {
  template: string; bg: string; ink: string; title: string; subtitle: string; customColors: boolean;
  logo: (Upload & { alpha: boolean }) | null; tint: boolean;
  photo: Upload | null; crop: Crop;
};

export const initialBack: BackState = {
  template: "classique", bg: "#134536", ink: "#F0E8D6", title: "", subtitle: "", customColors: false,
  logo: null, tint: false, photo: null, crop: { zoom: 1, x: 0.5, y: 0.5 },
};

const PAIRS: [string, string, string][] = [
  ["Vert tapis", "#134536", "#F0E8D6"], ["Nuit", "#1C2440", "#E8D6B0"], ["Noir et or", "#16161A", "#D9C08C"],
  ["Rouge", "#B3152A", "#FCEFE6"], ["Crème", "#F3EBDD", "#9C7A3C"], ["Blanc", "#FFFFFF", "#16161A"],
];

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  if (!images.has(url)) images.set(url, new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; }));
  return images.get(url)!;
}

/** Photo recadrée comme le moteur (cardart.crop_photo), en data URI pour le SVG. */
async function croppedPhoto(url: string, crop: Crop): Promise<string> {
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight, r = backRatio();
  const cw = Math.min(w, h * r) / Math.max(1, crop.zoom), ch = cw / r;
  const cx = Math.min(Math.max(crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(crop.y * h, ch / 2), h - ch / 2);
  const c = document.createElement("canvas"); c.width = 700; c.height = Math.round(700 / r);
  c.getContext("2d")!.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(blob); });
}

/** Le logo a-t-il de la transparence ? (sinon, le teinter donnerait un rectangle plein) */
export async function hasAlpha(url: string): Promise<boolean> {
  const img = await loadImage(url);
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/** SVG du dos pour un modèle donné (aperçu principal ou vignette de la galerie). */
export function useBackSvg(state: BackState, model?: BackModel, uid = "") {
  const [svg, setSvg] = useState("");
  const [logoData, setLogoData] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<string | null>(null);
  useEffect(() => { let live = true; (state.logo ? toDataUrl(state.logo.url) : Promise.resolve(null)).then((d) => live && setLogoData(d)); return () => { live = false; }; }, [state.logo]);
  useEffect(() => {
    let live = true;
    (state.photo && model?.photo ? croppedPhoto(state.photo.url, state.crop) : Promise.resolve(null)).then((d) => live && setPhotoData(d));
    return () => { live = false; };
  }, [state.photo, state.crop, model?.photo]);
  useEffect(() => {
    if (!model) return;
    let live = true;
    const colors = state.customColors || model.id === state.template ? { bg: state.bg, ink: state.ink } : { bg: model.bg, ink: model.ink };
    backTemplate(model.id).then((t) => live && setSvg(fillBack(t, backFields(model, {
      ...colors, title: state.title, subtitle: state.subtitle, logo: logoData, tint: state.tint && !!state.logo?.alpha, photo: photoData,
    }), uid)));
    return () => { live = false; };
  }, [model, state.template, state.customColors, state.bg, state.ink, state.title, state.subtitle, state.tint, state.logo?.alpha, logoData, photoData, uid]);
  return svg;
}

function Thumb({ model, state, selected, onPick }: { model: BackModel; state: BackState; selected: boolean; onPick: () => void }) {
  const svg = useBackSvg(state, model, `t-${model.id}`);
  return (
    <button className={`back-thumb${selected ? " on" : ""}`} onClick={onPick} aria-pressed={selected} title={model.hint}>
      <span className="svg" dangerouslySetInnerHTML={{ __html: svg }} />
      <b>{model.label}</b>
    </button>
  );
}

export function BackPreview({ state, models, onDrag }: { state: BackState; models: BackModel[]; onDrag?: (dx: number, dy: number, done: boolean) => void }) {
  const model = models.find((m) => m.id === state.template);
  const svg = useBackSvg(state, model);
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const draggable = !!(onDrag && model?.photo && state.photo);
  return (
    <div className={`back-stage${draggable ? " grab" : ""}`} dangerouslySetInnerHTML={{ __html: svg }}
      onPointerDown={(e) => { if (!draggable) return; e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); start.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; }}
      onPointerMove={(e) => { const s = start.current; if (s) onDrag!((e.clientX - s.x) / s.w, (e.clientY - s.y) / s.h, false); }}
      onPointerUp={() => { if (start.current) { start.current = null; onDrag!(0, 0, true); } }} />
  );
}

export default function BackStep({ state, set, models, pickLogo, pickPhoto, onNext }: {
  state: BackState; set: (patch: Partial<BackState>) => void; models: BackModel[];
  pickLogo: (f: File) => void; pickPhoto: (f: File) => void; onNext: () => void;
}) {
  const model = models.find((m) => m.id === state.template);
  const logoInput = useRef<HTMLInputElement>(null), photoInput = useRef<HTMLInputElement>(null);
  const needsLogo = model?.logo === "required" && !state.logo;
  const company = model?.logo !== undefined;
  const titleLabel = company ? "Nom (entreprise, association…)" : state.logo ? "Texte (affiché si pas de logo)" : "Texte principal";
  const pick = (m: BackModel) => set(state.customColors ? { template: m.id } : { template: m.id, bg: m.bg, ink: m.ink });
  const ordered = useMemo(() => models, [models]);

  return (
    <div className="step">
      <div className="field-group">
        <b>Modèle</b>
        <div className="back-gallery">
          {ordered.map((m) => <Thumb key={m.id} model={m} state={state} selected={m.id === state.template} onPick={() => pick(m)} />)}
        </div>
      </div>

      <div className="grid2">
        <label className="field">{titleLabel}<input maxLength={TITLE_MAX} value={state.title} placeholder={company ? "Boulangerie Martin" : "J & M"} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="field">{company ? "Slogan, date…" : "Texte secondaire"}<input maxLength={SUBTITLE_MAX} value={state.subtitle} placeholder={company ? "Depuis 1987" : "12 · 06 · 2027"} onChange={(e) => set({ subtitle: e.target.value })} /></label>
      </div>

      <div className="field-group">
        <b>Logo {needsLogo ? <span className="error-text">· ce modèle en a besoin</span> : <span className="hint">(facultatif)</span>}</b>
        <div className="row-actions">
          <button className="btn ghost small" onClick={() => logoInput.current?.click()}>{state.logo ? "Changer le logo" : "＋ Ajouter un logo"}</button>
          {state.logo && <button className="link" onClick={() => set({ logo: null, tint: false })}>Retirer</button>}
          {state.logo?.busy && <span className="hint"><span className="spinner" />Envoi…</span>}
          {state.logo?.error && <span className="error-text">{state.logo.error}</span>}
        </div>
        {state.logo && (state.logo.alpha
          ? <label className="check-row"><input type="checkbox" checked={state.tint} onChange={(e) => set({ tint: e.target.checked })} /> Logo d&apos;une seule couleur, dans la couleur du texte</label>
          : <p className="hint">Logo sur fond plein : il sera imprimé tel quel. Un PNG à fond transparent s&apos;intègre mieux au dos.</p>)}
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickLogo(f); }} />
      </div>

      {model?.photo && (
        <div className="field-group">
          <b>Photo</b>
          <div className="row-actions">
            <button className="btn ghost small" onClick={() => photoInput.current?.click()}>{state.photo ? "Changer la photo" : "＋ Ajouter une photo"}</button>
            {state.photo && <button className="link" onClick={() => set({ photo: null })}>Retirer</button>}
            {state.photo?.busy && <span className="hint"><span className="spinner" />Envoi…</span>}
          </div>
          {state.photo && <label className="field">Zoom · glissez la photo dans l&apos;aperçu pour la placer<input type="range" min={1} max={3} step={0.02} value={state.crop.zoom} onChange={(e) => set({ crop: { ...state.crop, zoom: +e.target.value } })} /></label>}
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickPhoto(f); }} />
        </div>
      )}

      <div className="field-group">
        <b>Couleurs</b>
        <div className="swatches">
          {PAIRS.map(([name, bg, ink]) => (
            <button key={name} title={name} aria-label={name} aria-pressed={state.bg === bg && state.ink === ink}
              style={{ background: bg, color: ink }} onClick={() => set({ bg, ink, customColors: true })}>Aa</button>
          ))}
        </div>
        <div className="color-pickers">
          <label>Fond <input type="color" value={state.bg} onChange={(e) => set({ bg: e.target.value.toUpperCase(), customColors: true })} /></label>
          <label>Texte et motifs <input type="color" value={state.ink} onChange={(e) => set({ ink: e.target.value.toUpperCase(), customColors: true })} /></label>
          <span className="hint">Vos couleurs de marque</span>
        </div>
      </div>

      <button className="btn red wide" disabled={needsLogo} onClick={onNext}>Continuer : les visages →</button>
    </div>
  );
}
