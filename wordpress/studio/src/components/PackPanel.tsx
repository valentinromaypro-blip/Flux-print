import { useEffect, useRef, useState } from "react";
import { api, endpoint, post } from "@/lib/api.ts";
import { type BoxDesign, type BoxInfo, drawBox, edgeColor, renderBox } from "@/lib/box.ts";

// Conditionnement, choisi une fois le jeu validé : sous film (inclus), étui à fenêtre (stock), ou
// étui personnalisé — créé ici (dos du jeu repris, photo, ou couleur et titre) ou envoyé en PDF
// sur le gabarit exact du jeu. `onChange` : supplément par jeu, et si l'ajout au panier est possible.

type Msg = { level: string; title: string; help: string };
type PackResult = { ok: boolean; preview?: string | null; messages: Msg[] };
const CHUNK = 4 * 1024 * 1024;
const euros = (v: number) => v.toFixed(2).replace(".", ",") + " €";

export default function PackPanel({ uid, onChange }: { uid: string; onChange: (extra: number, ready: boolean) => void }) {
  const [info, setInfo] = useState<BoxInfo | null>(null);
  const [pack, setPack] = useState("film");
  const [how, setHow] = useState<"online" | "pdf">("online");
  const [design, setDesign] = useState<BoxDesign | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [validated, setValidated] = useState<string | null>(null); // aperçu de l'étui validé
  const preview = useRef<HTMLCanvasElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<BoxInfo>(`jobs/${uid}/box`).then(async (i) => {
      setInfo(i);
      setPack(i.pack);
      const bg = i.design.bg ?? await edgeColor(i.back).catch(() => "#134536");
      setDesign({ face: "dos", photo: null, crop: { zoom: 1, x: 0.5, y: 0.5 }, bg, ink: i.design.ink ?? "#F0E8D6",
        title: i.design.title || "Carte Blanche", subtitle: i.design.subtitle ?? "", message: "" });
    }).catch(() => setInfo(null));
  }, [uid]);

  useEffect(() => {
    if (!info || !design || !preview.current || pack !== "custom" || how !== "online") return;
    drawBox(preview.current, info, design, true).catch(() => {});
  }, [info, design, pack, how]);

  const extra = (id: string) => info?.packs.find((p) => p.id === id)?.price ?? 0;
  const invalidate = () => { setValidated(null); onChange(extra("custom"), false); };
  const set = (patch: Partial<BoxDesign>) => { setDesign((d) => (d ? { ...d, ...patch } : d)); invalidate(); };

  async function choose(id: string) {
    setPack(id); setMessages([]); setValidated(null);
    if (id === "custom") { onChange(extra(id), false); return; }
    setBusy("…");
    try {
      const r = await post<PackResult>(`jobs/${uid}/pack`, JSON.stringify({ pack: id }));
      onChange(extra(id), r.ok);
    } catch (e) { setMessages([{ level: "error", title: (e as Error).message, help: "" }]); }
    setBusy("");
  }

  async function validate() {
    if (!info || !design) return;
    setMessages([]);
    try {
      if (how === "online") {
        setBusy("Fabrication de l'étui en qualité d'impression…");
        await post(`jobs/${uid}/file?role=box`, await renderBox(info, design), "image/jpeg");
      } else {
        if (!file) return;
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          setBusy(`Envoi du PDF de l'étui… ${Math.round((offset / file.size) * 100)} %`);
          await post(`jobs/${uid}/file?role=boxpdf&offset=${offset}`, file.slice(offset, offset + CHUNK), "application/pdf");
        }
      }
      setBusy("Contrôle de l'étui…");
      const r = await post<PackResult>(`jobs/${uid}/pack`, JSON.stringify({ pack: "custom" }));
      setMessages(r.messages);
      setValidated(r.ok ? r.preview ?? "" : null);
      onChange(extra("custom"), r.ok);
    } catch (e) {
      setMessages([{ level: "error", title: (e as Error).message, help: "" }]);
    }
    setBusy("");
  }

  if (!info) return null;
  const G = info.geometry;
  return (
    <div className="cb-pack">
      <b>Conditionnement</b>
      <div className="cb-media" role="radiogroup" aria-label="Conditionnement">
        {info.packs.map((p) => (
          <button type="button" key={p.id} role="radio" aria-checked={pack === p.id} disabled={!!busy} onClick={() => choose(p.id)}>
            <b>{p.label}</b><span>{p.hint} · {p.price ? `+${euros(p.price)}` : "inclus"}</span>
          </button>
        ))}
      </div>

      {pack === "custom" && design && (
        <div className="cb-box">
          <div className="seg" role="radiogroup" aria-label="Façon de créer l'étui">
            <button type="button" role="radio" aria-checked={how === "online"} onClick={() => { setHow("online"); invalidate(); }}>Créer l&apos;étui ici</button>
            <button type="button" role="radio" aria-checked={how === "pdf"} onClick={() => { setHow("pdf"); invalidate(); }}>J&apos;ai mon PDF</button>
          </div>

          {how === "online" ? (
            <>
              <canvas ref={preview} className="cb-box-preview" width={640}
                height={Math.round((640 * (G.H + 2 * G.bleed)) / (G.W + 2 * G.bleed))} aria-label="Aperçu de l'étui à plat" />
              <p className="hint">Étui à plat : de gauche à droite, patte de collage, dos, tranche, face, tranche. En magenta la découpe, en bleu les plis.</p>
              <div className="seg" role="radiogroup" aria-label="Face avant de l'étui">
                {([["dos", "Le dos du jeu"], ["photo", "Une photo"], ["couleur", "Couleur et titre"]] as const).map(([k, l]) => (
                  <button type="button" key={k} role="radio" aria-checked={design.face === k}
                    onClick={() => (k === "photo" && !design.photo ? photoPicker.current?.click() : set({ face: k }))}>{l}</button>
                ))}
              </div>
              {design.face === "photo" && <button type="button" className="link" onClick={() => photoPicker.current?.click()}>Changer de photo</button>}
              <div className="cb-box-fields">
                <label className="field">Titre <span className="hint">(tranches{design.face === "couleur" ? " et face" : ""})</span>
                  <input maxLength={40} value={design.title} onChange={(e) => set({ title: e.target.value })} /></label>
                {design.face === "couleur" && (
                  <label className="field">Sous-titre <input maxLength={60} value={design.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
                )}
                <label className="field">Message au dos de l&apos;étui <span className="hint">(facultatif ; sinon, même visuel que la face)</span>
                  <textarea rows={3} maxLength={280} value={design.message} onChange={(e) => set({ message: e.target.value })} /></label>
                <div className="cb-box-colors">
                  <label>Fond <input type="color" value={design.bg} onChange={(e) => set({ bg: e.target.value })} /></label>
                  <label>Texte <input type="color" value={design.ink} onChange={(e) => set({ ink: e.target.value })} /></label>
                </div>
              </div>
              <input ref={photoPicker} type="file" accept="image/jpeg,image/png,image/webp" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) set({ face: "photo", photo: URL.createObjectURL(f) }); }} />
            </>
          ) : (
            <div className="step">
              <p className="hint">
                Étui de {G.w.toFixed(1).replace(".", ",")} × {G.h.toFixed(1).replace(".", ",")} × {G.d.toFixed(1).replace(".", ",")} mm, calculé pour votre jeu.
                Téléchargez le gabarit, placez votre visuel (fond perdu de {G.bleed} mm compris), retirez les textes du gabarit et exportez en PDF, page au même format.
              </p>
              <a className="btn ghost small" href={endpoint(`jobs/${uid}/box-template`)}>Télécharger le gabarit PDF</a>
              <label className={`cb-drop${file ? " on" : ""}`} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); invalidate(); } }}>
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); invalidate(); }} />
                {file ? <><b>{file.name}</b><span>cliquez pour changer</span></> : <><b>Choisir le PDF de l&apos;étui</b><span>ou le glisser ici</span></>}
              </label>
            </div>
          )}

          {validated !== null
            ? <p className="cb-msg ok"><b>Étui validé</b>{validated && <img src={validated} alt="Étui à plat" className="cb-box-thumb" />}</p>
            : <button type="button" className="btn red wide" disabled={!!busy || (how === "pdf" && !file)} onClick={validate}>{busy || "Valider l'étui"}</button>}
        </div>
      )}
      {messages.length > 0 && (
        <ul className="cb-messages">{messages.map((m, i) => <li key={i} className={`cb-msg ${m.level}`}><b>{m.title}</b>{m.help && <span>{m.help}</span>}</li>)}</ul>
      )}
    </div>
  );
}
