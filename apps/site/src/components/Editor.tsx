"use client";
import { useEffect, useRef, useState } from "react";
import { type Crop, type Design, RANKS, SUITS } from "@/lib/design.ts";

// Éditeur « création en ligne » : dos + figures. L'aperçu est une approximation dessinée
// dans le navigateur ; le rendu d'impression est fabriqué par le moteur puis contrôlé.

type LocalPhoto = { url: string; path: string | null; crop: Crop; error?: string };
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

async function drawCourt(canvas: HTMLCanvasElement, code: string, name: string, photo: LocalPhoto | null) {
  const c = canvas.getContext("2d")!;
  const [suit, rank] = code.split("-");
  const s = SUITS.find(([k]) => k === suit)!, r = RANKS.find(([k]) => k === rank)!;
  const color = suit === "H" || suit === "D" ? "#C4172C" : "#16161A";
  c.clearRect(0, 0, W, H);
  roundRect(c, 0, 0, W, H, 14); c.fillStyle = "#FCFCFA"; c.fill(); c.strokeStyle = "#E3E1DC"; c.lineWidth = 1; c.stroke();
  const half = async (flip: boolean) => {
    c.save();
    if (flip) { c.translate(W, H); c.rotate(Math.PI); }
    c.fillStyle = color; c.textAlign = "center"; c.font = "800 24px system-ui, sans-serif"; c.fillText(r[1], 17.6, 32);
    c.font = "18px system-ui, sans-serif"; c.fillText(s[1], 17.6, 50);
    c.beginPath(); c.rect(38.4, 38.4, W - 76.8, H / 2 - 38.4); c.clip();
    const cx = W / 2, cy = (H / 2) - 76;
    c.beginPath(); c.ellipse(cx, cy + 76 + 20, 54, 54, 0, Math.PI, 0); c.fillStyle = color; c.fill();
    if (photo) {
      const img = await loadImage(photo.url);
      c.save(); c.beginPath(); c.arc(cx, cy, 30.2, 0, Math.PI * 2); c.closePath();
      c.fillStyle = "#BE9646"; c.beginPath(); c.arc(cx, cy, 32.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(cx, cy, 30.2, 0, Math.PI * 2); c.clip();
      c.drawImage(img, ...cropRect(img, photo.crop, 1), cx - 30.2, cy - 30.2, 60.4, 60.4); c.restore();
    } else {
      c.beginPath(); c.arc(cx, cy, 22, 0, Math.PI * 2); c.fillStyle = "#F1CFB4"; c.fill();
      c.beginPath(); c.arc(cx, cy - 4, 23, Math.PI, 0); c.fillStyle = "#34241C"; c.fill();
    }
    c.fillStyle = "#BE9646";
    c.beginPath(); c.moveTo(cx - 20, cy - 30); c.lineTo(cx - 20, cy - 50); c.lineTo(cx - 10, cy - 38); c.lineTo(cx, cy - 54);
    c.lineTo(cx + 10, cy - 38); c.lineTo(cx + 20, cy - 50); c.lineTo(cx + 20, cy - 30); c.fill();
    c.restore();
    if (name) {
      c.save(); if (flip) { c.translate(W, H); c.rotate(Math.PI); }
      roundRect(c, W / 2 - 46, H / 2 - 17.6, 92, 15.2, 7.6); c.fillStyle = "#FCFCFA"; c.fill(); c.strokeStyle = color; c.lineWidth = 1.2; c.stroke();
      c.fillStyle = color; c.font = "600 8.8px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(name.toUpperCase(), W / 2, H / 2 - 10); c.restore();
    }
  };
  await half(false); await half(true);
  c.strokeStyle = color; c.lineWidth = 1.6; roundRect(c, 38.4, 38.4, W - 76.8, H - 76.8, 7); c.stroke();
  c.beginPath(); c.moveTo(38.4, H / 2); c.lineTo(W - 38.4, H / 2); c.lineWidth = 1.2; c.stroke();
}

function PhotoField({ id, photo, product, disabled, onChange }: {
  id: string; photo: LocalPhoto | null; product: string; disabled: boolean; onChange: (p: LocalPhoto | null) => void;
}) {
  async function pick(file: File) {
    const local: LocalPhoto = { url: URL.createObjectURL(file), path: null, crop: { zoom: 1, x: 0.5, y: 0.4 } };
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
          <label className="field">Zoom<input type="range" min={1} max={3} step={0.05} value={photo.crop.zoom} disabled={disabled} onChange={(e) => set("zoom", Number(e.target.value))} /></label>
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
  const backCanvas = useRef<HTMLCanvasElement>(null);
  const courtCanvas = useRef<HTMLCanvasElement>(null);
  const court = courts[selected] ?? { name: "", photo: null };
  const uploading = [backPhoto, ...Object.values(courts).map((c) => c.photo)].some((p) => p && !p.path && !p.error);

  useEffect(() => { if (backCanvas.current) drawBack(backCanvas.current, { ...back, photo: null }, backPhoto); }, [back, backPhoto]);
  useEffect(() => { if (courtCanvas.current) drawCourt(courtCanvas.current, selected, court.name, court.photo); }, [selected, court.name, court.photo]);

  const setCourt = (patch: Partial<{ name: string; photo: LocalPhoto | null }>) =>
    setCourts((all) => ({ ...all, [selected]: { ...court, ...patch } }));
  const done = Object.entries(courts).filter(([, c]) => c.name || c.photo).length;

  function submit() {
    const ref = (p: LocalPhoto | null) => (p?.path ? { path: p.path, ...p.crop } : null);
    onSubmit({
      back: { ...back, photo: ref(backPhoto) },
      courts: Object.fromEntries(Object.entries(courts).filter(([, c]) => c.name || c.photo).map(([k, c]) => [k, { name: c.name, photo: ref(c.photo) }])),
    });
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="previews" style={{ gap: 16 }}>
        <figure style={{ margin: 0, display: "grid", gap: 6, justifyItems: "center" }}><canvas ref={backCanvas} width={W} height={H} style={{ width: 150, height: "auto" }} aria-label="Aperçu du dos" /><span className="hint">Dos</span></figure>
        <figure style={{ margin: 0, display: "grid", gap: 6, justifyItems: "center" }}><canvas ref={courtCanvas} width={W} height={H} style={{ width: 150, height: "auto" }} aria-label="Aperçu de la figure" /><span className="hint">{RANKS.find(([r]) => r === selected.split("-")[1])![2]} de {SUITS.find(([s]) => s === selected.split("-")[0])![2]}</span></figure>
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
        <PhotoField id={`photo-${selected}`} photo={court.photo} product={product} disabled={disabled} onChange={(photo) => setCourt({ photo })} />
        <p className="hint">Une photo de face, bien éclairée, avec le visage au centre. Les figures sans photo gardent leur portrait illustré.</p>
      </div>

      <button className="btn red" disabled={disabled || uploading} onClick={submit}>
        {uploading ? "Envoi des photos…" : "Valider mon jeu et voir l'aperçu d'impression"}
      </button>
    </div>
  );
}
