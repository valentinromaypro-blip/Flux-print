"use client";
import { useEffect, useRef, useState } from "react";
import { type Crop, type Design, RANKS, SUITS } from "@/lib/design.ts";

// Éditeur « création en ligne » : dos + figures. L'aperçu est dessiné dans le navigateur avec les
// mêmes cartes que le moteur ; le rendu d'impression est fabriqué par le moteur puis contrôlé.

type LocalPhoto = { url: string; path: string | null; crop: Crop; error?: string };
type Style = "gravure" | "couleur";
type Props = { product: string; disabled: boolean; onSubmit: (design: Design) => void };

const COLORS: [string, string, string][] = [
  ["Vert tapis", "#134536", "#F0E8D6"], ["Nuit", "#1C2440", "#E8D6B0"], ["Noir", "#16161A", "#E6E4DE"],
  ["Rouge", "#B3152A", "#FCEFE6"], ["Crème", "#F3EBDD", "#9C7A3C"], ["Rose", "#EEC4C8", "#78203C"],
];
const W = 254, H = 356; // aperçu à l'échelle 4 px/mm

async function uploadPhoto(product: string, file: File): Promise<string> {
  const res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, size: file.size, kind: "photo", type: file.type }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error);
  const put = await fetch(out.target.url, { method: out.target.method, headers: out.target.headers, body: file });
  if (!put.ok) throw new Error("L'envoi de la photo a échoué.");
  return out.path as string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
}

/** Même recadrage que le moteur (cardart.crop_photo). */
function cropRect(img: HTMLImageElement, crop: Crop, ratio: number) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cw = Math.min(w, h * ratio) / Math.max(1, crop.zoom), ch = cw / ratio;
  const cx = Math.min(Math.max(crop.x * w, cw / 2), w - cw / 2), cy = Math.min(Math.max(crop.y * h, ch / 2), h - ch / 2);
  return [cx - cw / 2, cy - ch / 2, cw, ch] as const;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}

async function drawBack(canvas: HTMLCanvasElement, back: Design["back"], photo: LocalPhoto | null) {
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, W, H);
  roundRect(c, 0, 0, W, H, 14); c.fillStyle = back.color; c.fill();
  c.strokeStyle = back.ink; c.lineWidth = 1.2; roundRect(c, 11, 11, W - 22, H - 22, 6); c.stroke();
  const ix = 17.6, iy = 17.6, iw = W - 35.2, ih = H - 35.2;
  c.save(); roundRect(c, ix, iy, iw, ih, 3); c.clip();
  if (photo) {
    const img = await loadImage(photo.url);
    c.drawImage(img, ...cropRect(img, photo.crop, iw / ih), ix, iy, iw, ih);
  } else {
    c.globalAlpha = 0.27; c.fillStyle = back.ink;
    for (let row = 0, y = iy; y < iy + ih + 18; row++, y += 18.4) {
      for (let x = ix + (row % 2 ? 9.2 : 0); x < ix + iw + 18; x += 18.4) {
        c.beginPath(); c.moveTo(x, y - 3.6); c.lineTo(x + 3.6, y); c.lineTo(x, y + 3.6); c.lineTo(x - 3.6, y); c.fill();
      }
    }
  }
  c.restore(); c.globalAlpha = 1;
  if (photo && !back.title && !back.subtitle) return;
  c.beginPath(); c.arc(W / 2, H / 2, 60, 0, Math.PI * 2); c.fillStyle = back.color; c.fill();
  c.lineWidth = 1.6; c.strokeStyle = back.ink; c.stroke();
  c.beginPath(); c.arc(W / 2, H / 2, 54.4, 0, Math.PI * 2); c.lineWidth = 0.8; c.stroke();
  c.fillStyle = back.ink; c.textAlign = "center"; c.textBaseline = "middle";
  if (back.subtitle) {
    c.font = "600 23px Georgia, serif"; c.fillText(back.title, W / 2, H / 2 - 10, 100);
    c.font = "600 9.5px system-ui, sans-serif"; c.fillText(back.subtitle, W / 2, H / 2 + 19, 100);
  } else {
    c.font = "800 44px system-ui, sans-serif"; c.fillText(back.title || (photo ? "" : "CB"), W / 2, H / 2 + 2, 100);
  }
}

// Figures classiques (A. Kennard, CC0) : mêmes fichiers et mêmes emplacements de visage que le moteur
// (flux_print/design/classic). Unités de la carte : 240 × 336.
type Slot = [number, number, number, number, number];
let slotsPromise: Promise<Record<string, Slot>> | null = null;
const faceSlots = () => (slotsPromise ??= fetch("/cartes/faces.json").then((r) => r.json()));

/** Gravure : niveaux de gris étirés puis dégradé bleu nuit → bleu du trait → blanc (cf. classic.stylise). */
function engrave(c: CanvasRenderingContext2D, w: number, h: number) {
  const im = c.getImageData(0, 0, w, h), d = im.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; lo = Math.min(lo, g); hi = Math.max(hi, g); }
  const stops: [number, number[]][] = [[10, [18, 18, 96]], [110, [88, 88, 240]], [235, [255, 255, 255]]];
  for (let i = 0; i < d.length; i += 4) {
    const g = ((d[i] - lo) * 255) / Math.max(1, hi - lo);
    const [[a, ca], [b, cb]] = g < stops[1][0] ? [stops[0], stops[1]] : [stops[1], stops[2]];
    const t = Math.min(1, Math.max(0, (g - a) / (b - a)));
    for (let k = 0; k < 3; k++) d[i + k] = ca[k] + (cb[k] - ca[k]) * t;
  }
  c.putImageData(im, 0, 0);
}

async function drawCourt(canvas: HTMLCanvasElement, code: string, name: string, photo: LocalPhoto | null, style: Style) {
  const c = canvas.getContext("2d")!;
  const art = code.replace("-", "");
  const [card, slots] = await Promise.all([loadImage(`/cartes/${art}.svg`), faceSlots()]);
  const k = W / 240;
  c.clearRect(0, 0, W, H);
  c.drawImage(card, 0, 0, W, H);
  if (photo) {
    const [cx, cy, rx, ry, top] = slots[art];
    const img = await loadImage(photo.url);
    const fw = Math.round(2 * rx * k), fh = Math.round(2 * ry * k);
    const face = document.createElement("canvas"); face.width = fw; face.height = fh;
    const f = face.getContext("2d")!;
    f.drawImage(img, ...cropRect(img, photo.crop, rx / ry), 0, 0, fw, fh);
    if (style === "gravure") engrave(f, fw, fh);
    const e = 1.6 * k;
    const head = (flip: boolean) => {
      c.save();
      if (flip) { c.translate(W, H); c.rotate(Math.PI); }
      c.beginPath(); c.rect(0, top * k, W, H); c.clip();
      c.beginPath(); c.ellipse(cx * k, cy * k, rx * k - e, ry * k - e, 0, 0, Math.PI * 2);
      c.save(); c.clip(); c.drawImage(face, (cx - rx) * k, (cy - ry) * k); c.restore();
      c.strokeStyle = "#44F"; c.lineWidth = 1.1 * k; c.stroke();
      c.restore();
    };
    head(false); head(true);
  }
  if (name) {
    c.font = `600 ${11 * k}px Georgia, serif`;
    const w = c.measureText(name.toUpperCase()).width + 22 * k, h = 17 * k;
    roundRect(c, W / 2 - w / 2, H / 2 - h / 2, w, h, 3 * k); c.fillStyle = "#FFFAEB"; c.fill();
    c.strokeStyle = "#44F"; c.lineWidth = 1.1 * k; c.stroke();
    c.fillStyle = "#BE141E"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(name.toUpperCase(), W / 2, H / 2 + 0.5 * k);
  }
}

function PhotoField({ id, photo, product, disabled, onChange, initial = { zoom: 1, x: 0.5, y: 0.4 } }: {
  id: string; initial?: Crop; photo: LocalPhoto | null; product: string; disabled: boolean; onChange: (p: LocalPhoto | null) => void;
}) {
  async function pick(file: File) {
    const local: LocalPhoto = { url: URL.createObjectURL(file), path: null, crop: initial };
    onChange(local);
    try { onChange({ ...local, path: await uploadPhoto(product, file) }); }
    catch (e) { onChange({ ...local, error: (e as Error).message }); }
  }
  const set = (k: keyof Crop, v: number) => photo && onChange({ ...photo, crop: { ...photo.crop, [k]: v } });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="row-actions">
        <label className="btn ghost" htmlFor={id} style={{ padding: "11px 16px" }}>{photo ? "Changer la photo" : "Ajouter une photo"}</label>
        <input id={id} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled}
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        {photo && <button className="link" disabled={disabled} onClick={() => onChange(null)}>Retirer</button>}
        {photo && !photo.path && !photo.error && <span className="hint"><span className="spinner" />Envoi…</span>}
        {photo?.error && <span className="error-text">{photo.error}</span>}
      </div>
      {photo && (
        <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label className="field">Zoom<input type="range" min={1} max={4} step={0.05} value={photo.crop.zoom} disabled={disabled} onChange={(e) => set("zoom", Number(e.target.value))} /></label>
          <label className="field">Horizontal<input type="range" min={0} max={1} step={0.01} value={photo.crop.x} disabled={disabled} onChange={(e) => set("x", Number(e.target.value))} /></label>
          <label className="field">Vertical<input type="range" min={0} max={1} step={0.01} value={photo.crop.y} disabled={disabled} onChange={(e) => set("y", Number(e.target.value))} /></label>
        </div>
      )}
    </div>
  );
}

export default function Editor({ product, disabled, onSubmit }: Props) {
  const [back, setBack] = useState({ color: "#134536", ink: "#F0E8D6", title: "", subtitle: "" });
  const [backPhoto, setBackPhoto] = useState<LocalPhoto | null>(null);
  const [courts, setCourts] = useState<Record<string, { name: string; photo: LocalPhoto | null }>>({});
  const [selected, setSelected] = useState("H-K");
  const [style, setStyle] = useState<Style>("gravure");
  const backCanvas = useRef<HTMLCanvasElement>(null);
  const courtCanvas = useRef<HTMLCanvasElement>(null);
  const court = courts[selected] ?? { name: "", photo: null };
  const uploading = [backPhoto, ...Object.values(courts).map((c) => c.photo)].some((p) => p && !p.path && !p.error);

  useEffect(() => { if (backCanvas.current) drawBack(backCanvas.current, { ...back, photo: null }, backPhoto); }, [back, backPhoto]);
  useEffect(() => { if (courtCanvas.current) drawCourt(courtCanvas.current, selected, court.name, court.photo, style); }, [selected, court.name, court.photo, style]);

  const setCourt = (patch: Partial<{ name: string; photo: LocalPhoto | null }>) =>
    setCourts((all) => ({ ...all, [selected]: { ...court, ...patch } }));
  const done = Object.entries(courts).filter(([, c]) => c.name || c.photo).length;

  function submit() {
    const ref = (p: LocalPhoto | null) => (p?.path ? { path: p.path, ...p.crop } : null);
    onSubmit({
      back: { ...back, photo: ref(backPhoto) },
      style,
      courts: Object.fromEntries(Object.entries(courts).filter(([, c]) => c.name || c.photo).map(([k, c]) => [k, { name: c.name, photo: ref(c.photo) }])),
    });
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="previews" style={{ gap: 16 }}>
        <figure style={{ margin: 0, display: "grid", gap: 6, justifyItems: "center" }}><canvas ref={backCanvas} width={W} height={H} style={{ width: 150, height: "auto" }} aria-label="Aperçu du dos" /><span className="hint">Dos</span></figure>
        <figure style={{ margin: 0, display: "grid", gap: 6, justifyItems: "center" }}><canvas ref={courtCanvas} width={W} height={H} style={{ width: 190, height: "auto" }} aria-label="Aperçu de la figure" /><span className="hint">{RANKS.find(([r]) => r === selected.split("-")[1])![2]} de {SUITS.find(([s]) => s === selected.split("-")[0])![2]}</span></figure>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <b>Le dos, commun à toutes les cartes</b>
        <div className="chips">{COLORS.map(([label, color, ink]) => (
          <button key={color} className="chip" aria-pressed={back.color === color} disabled={disabled} onClick={() => setBack({ ...back, color, ink })}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: color, border: "1px solid #0002", marginRight: 6, verticalAlign: -1 }} />{label}
          </button>))}</div>
        <div className="grid2">
          <label className="field">Texte principal<input id="back-title" maxLength={12} value={back.title} disabled={disabled} placeholder="J & M" onChange={(e) => setBack({ ...back, title: e.target.value })} /></label>
          <label className="field">Texte secondaire<input id="back-subtitle" maxLength={24} value={back.subtitle} disabled={disabled} placeholder="12 · 06 · 2027" onChange={(e) => setBack({ ...back, subtitle: e.target.value })} /></label>
        </div>
        <PhotoField id="back-photo" photo={backPhoto} product={product} disabled={disabled} onChange={setBackPhoto} />
        <p className="hint">Conseil : un dos symétrique, sans cadre trop près du bord, garde vos cartes indiscernables une fois retournées.</p>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <b>Les figures<span className="hint" style={{ fontWeight: 400 }}> · {done} personnalisée{done > 1 ? "s" : ""} sur 12</span></b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {SUITS.map(([s, glyph]) => RANKS.map(([r, letter]) => {
            const code = `${s}-${r}`, filled = !!(courts[code]?.name || courts[code]?.photo);
            return (
              <button key={code} className="chip" aria-pressed={selected === code} disabled={disabled} onClick={() => setSelected(code)}
                style={{ padding: "9px 6px", color: selected === code ? undefined : s === "H" || s === "D" ? "#C4172C" : undefined }}>
                {letter}{glyph}{filled ? " ✓" : ""}
              </button>);
          }))}
        </div>
        <label className="field">Prénom sur la figure<input id="court-name" maxLength={14} value={court.name} disabled={disabled} placeholder="Papa, Mamie, Léo…" onChange={(e) => setCourt({ name: e.target.value })} /></label>
        <PhotoField id={`photo-${selected}`} photo={court.photo} product={product} disabled={disabled} onChange={(photo) => setCourt({ photo })}
          initial={{ zoom: 2.2, x: 0.5, y: 0.38 }} />
        <div className="row-actions" role="radiogroup" aria-label="Rendu des visages">
          <span className="hint">Rendu des visages</span>
          {(["gravure", "couleur"] as const).map((v) => (
            <button key={v} className="chip" role="radio" aria-checked={style === v} aria-pressed={style === v} disabled={disabled} onClick={() => setStyle(v)}>
              {v === "gravure" ? "Gravure (comme le dessin)" : "Photo couleur"}</button>))}
        </div>
        <p className="hint">Le visage remplace la tête du personnage, sous sa couronne, en haut et en bas de la carte. Photo de face, bien éclairée : cadrez le visage du front au menton. Les figures sans photo gardent leur visage d'origine.</p>
      </div>

      <button className="btn red" disabled={disabled || uploading} onClick={submit}>
        {uploading ? "Envoi des photos…" : "Valider mon jeu et voir l'aperçu d'impression"}
      </button>
    </div>
  );
}
