import { useEffect, useRef, useState } from "react";
import type { BackState } from "@/components/BackStep";
import type { BackModel } from "@/lib/backs.ts";
import { renderBack } from "@/lib/print.ts";
import { endpoint } from "@/lib/api.ts";
import { type BoxDesign, boxSize, drawMockup, type Pack } from "@/lib/box.ts";
import { CB } from "@/lib/env.ts";
import { format } from "@/lib/format.ts";

// Étape « L'étui » : le client voit son jeu tel qu'il le recevra (sous film, dans l'étui à fenêtre
// Carte Blanche qui laisse voir son dos, ou dans un étui à son image) avant de valider. L'étui
// personnalisé se règle ici ; son fichier exact est fabriqué et contrôlé à la validation du jeu.

export type PackChoice = { pack: Pack; how: "online" | "pdf"; design: BoxDesign; file: File | null; touched: boolean };
export const initialPack = (): PackChoice => ({
  pack: "film", how: "online", file: null, touched: false,
  design: { face: "dos", photo: null, crop: { zoom: 1, x: 0.5, y: 0.5 }, bg: "#134536", ink: "#F0E8D6", title: "Carte Blanche", subtitle: "", message: "" },
});
const euros = (v: number) => v.toFixed(2).replace(".", ",") + " €";
const mm = (v: number) => v.toFixed(1).replace(".", ",").replace(",0", "");

/** Étui personnalisé « PDF » choisi sans fichier : la validation attend le fichier. */
export const needsBoxFile = (c: PackChoice) => c.pack === "custom" && c.how === "pdf" && !c.file;

/** Offres proposées pour le format choisi (l'étui à fenêtre existe dans certains formats seulement). */
export const packOffer = (id: Pack) => CB.spec.packs.find((p) => p.id === id);
export const packAvailable = (id: Pack) => { const p = packOffer(id); return !!p && (!p.formats || p.formats.includes(format().key)); };

/** Le dos du jeu en image (pour les maquettes), refait quand il change et que l'étape est affichée. */
export function useBackImage(back: BackState, model: BackModel | undefined, active: boolean) {
  const [url, setUrl] = useState("");
  const key = JSON.stringify([back.template, back.bg, back.ink, back.title, back.subtitle, back.tint, back.crop, back.logo?.url, back.photo?.url]);
  useEffect(() => {
    if (!active || !model) return;
    let live = true;
    const t = setTimeout(() => renderBack({ back, model }).then((b) => {
      if (!live) return;
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
    }).catch(() => {}), 200);
    return () => { live = false; clearTimeout(t); };
  }, [key, active, model]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/** Récapitulatif du conditionnement (finitions, rapport). */
export function PackSummary({ choice }: { choice: PackChoice }) {
  const offer = packOffer(choice.pack);
  if (!offer) return null;
  return <p className="cb-pack-summary"><b>{offer.label}</b>{offer.price ? ` · + ${euros(offer.price)} par jeu` : " · inclus"}</p>;
}

export function Mockup({ pack, back, cards, media, design, width, height, className, turned = false }: {
  pack: Pack; back: string; cards: number; media: string; design?: BoxDesign; width: number; height: number; className?: string; turned?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current && back) drawMockup(ref.current, pack, back, cards, media, design, turned).catch(() => {}); }, [pack, back, cards, media, design, turned]);
  return <canvas ref={ref} width={width} height={height} className={className} aria-hidden />;
}

/** Grand aperçu de la colonne de gauche, avec « retourner » pour voir le dos de l'étui. */
export function StageMockup({ choice, back, cards, media }: { choice: PackChoice; back: string; cards: number; media: string }) {
  const [turned, setTurned] = useState(false);
  const [live, setLive] = useState(choice.design);
  useEffect(() => { const t = setTimeout(() => setLive(choice.design), 150); return () => clearTimeout(t); }, [choice.design]);
  const pack = packAvailable(choice.pack) ? choice.pack : "film";
  return (
    <>
      <Mockup pack={pack} back={back} cards={cards} media={media} design={live} width={720} height={720} className="cb-stage-mockup" turned={turned && pack !== "film"} />
      {pack !== "film" && <button type="button" className="cb-turn" onClick={() => setTurned((t) => !t)}>{turned ? "↺ Voir l'avant" : "↻ Voir l'arrière"}</button>}
    </>
  );
}

export default function PackStep({ choice, set, back, cards, media, defaults, nav, big = false }: {
  choice: PackChoice; set: (patch: Partial<PackChoice>) => void; back: string; cards: number; media: string;
  defaults?: { bg: string; ink: string; title: string; subtitle: string }; nav?: React.ReactNode; big?: boolean;
}) {
  const photo = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(choice.design); // aperçu : suit la saisie avec un léger retard
  useEffect(() => { const t = setTimeout(() => setLive(choice.design), 150); return () => clearTimeout(t); }, [choice.design]);
  // Tant que le client n'a pas touché à l'étui, il reprend les couleurs et le titre du dos
  useEffect(() => {
    if (defaults && !choice.touched) set({ design: { ...choice.design, ...defaults, title: defaults.title || "Carte Blanche" } });
  }, [defaults?.bg, defaults?.ink, defaults?.title, defaults?.subtitle]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = choice.design;
  const edit = (patch: Partial<BoxDesign>) => set({ design: { ...d, ...patch }, touched: true });
  const [w, h, t] = boxSize(cards, media);
  const template = endpoint(`box-template?product_id=${CB.productId}&format=${format().key}&media=${media}&cards=${cards}`);

  return (
    <div className="step cb-pack-step">
      <p className="hint">Votre jeu est livré sous film. Pour l&apos;offrir ou le ranger, choisissez un étui :</p>
      <div className="cb-packs" role="radiogroup" aria-label="Conditionnement">
        {(["film", "fenetre", "custom"] as const).map((id) => {
          const offer = packOffer(id), ok = packAvailable(id);
          if (!offer) return null;
          return (
            <button type="button" key={id} role="radio" aria-checked={choice.pack === id} disabled={!ok}
              className={`cb-pack${choice.pack === id ? " on" : ""}`} onClick={() => set({ pack: id })}>
              {offer.photo
                ? <img src={offer.photo} alt="" className="cb-pack-photo" loading="lazy" />
                : <Mockup pack={id} back={back} cards={cards} media={media} design={id === "custom" ? live : undefined} width={300} height={260} />}
              <b>{offer.label}</b>
              <span>{ok ? offer.hint : "Disponible en format poker"}</span>
              <em>{offer.price ? `+ ${euros(offer.price)}` : "Inclus"}</em>
            </button>
          );
        })}
      </div>

      {choice.pack === "custom" && (
        <div className="cb-box">
          <div className="cb-box-head">
            {big && <Mockup pack="custom" back={back} cards={cards} media={media} design={live} width={560} height={460} className="cb-box-big" />}
            <p className="hint">Étui fermé imprimé sur toutes ses faces, calculé pour vos {cards} cartes : environ {mm(w)} × {mm(h)} × {mm(t)} mm.</p>
          </div>
          <div className="seg" role="radiogroup" aria-label="Façon de créer l'étui">
            <button type="button" role="radio" aria-checked={choice.how === "online"} onClick={() => set({ how: "online" })}>Je crée mon étui ici</button>
            <button type="button" role="radio" aria-checked={choice.how === "pdf"} onClick={() => set({ how: "pdf" })}>J&apos;ai mon fichier PDF</button>
          </div>
          {choice.how === "online" ? (
            <div className="cb-box-fields">
              <b>Face avant</b>
              <div className="seg" role="radiogroup" aria-label="Face avant de l'étui">
                {([["dos", "Le dos de mes cartes"], ["photo", "Une photo"], ["couleur", "Couleur et titre"]] as const).map(([k, l]) => (
                  <button type="button" key={k} role="radio" aria-checked={d.face === k}
                    onClick={() => (k === "photo" && !d.photo ? photo.current?.click() : edit({ face: k }))}>{l}</button>
                ))}
              </div>
              {d.face === "photo" && <button type="button" className="link" onClick={() => photo.current?.click()}>Changer de photo</button>}
              <label className="field">Titre <span className="hint">(sur les tranches{d.face === "couleur" ? " et la face" : ""})</span>
                <input maxLength={40} value={d.title} onChange={(e) => edit({ title: e.target.value })} /></label>
              {d.face === "couleur" && <label className="field">Sous-titre <input maxLength={60} value={d.subtitle} onChange={(e) => edit({ subtitle: e.target.value })} /></label>}
              <label className="field">Un mot au dos de l&apos;étui <span className="hint">(facultatif)</span>
                <textarea rows={2} maxLength={280} value={d.message} placeholder="Joyeux anniversaire ! De la part de toute la famille" onChange={(e) => edit({ message: e.target.value })} /></label>
              <div className="cb-box-colors">
                <label>Fond <input type="color" value={d.bg} onChange={(e) => edit({ bg: e.target.value })} /></label>
                <label>Texte <input type="color" value={d.ink} onChange={(e) => edit({ ink: e.target.value })} /></label>
              </div>
              <input ref={photo} type="file" accept="image/jpeg,image/png,image/webp" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) edit({ face: "photo", photo: URL.createObjectURL(f) }); }} />
            </div>
          ) : (
            <div className="cb-box-fields">
              <p className="hint">Téléchargez le gabarit de votre étui, placez votre visuel (3 mm de fond perdu compris), retirez les textes du gabarit et exportez en PDF au même format. Nous le contrôlons à la validation.</p>
              <a className="btn ghost small" href={template}>Télécharger le gabarit</a>
              <label className={`cb-drop${choice.file ? " on" : ""}`} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) set({ file: f }); }}>
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
                {choice.file ? <><b>{choice.file.name}</b><span>cliquez pour changer</span></> : <><b>Choisir le PDF de l&apos;étui</b><span>ou le glisser ici</span></>}
              </label>
            </div>
          )}
        </div>
      )}
      {nav}
    </div>
  );
}
