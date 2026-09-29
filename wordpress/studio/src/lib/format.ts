// Format de carte en cours (poker, bridge, tarot) : taille du dos, des cartes et fichiers d'impression.
import { CB } from "@/lib/env.ts";

export type Format = { key: string; label: string; trim: [number, number]; page: [number, number] };
const DPI = 350;
let current: Format = CB.spec.formats[0];

export const formats = () => CB.spec.formats;
export const format = () => current;
export function setFormat(key: string) {
  current = CB.spec.formats.find((f) => f.key === key) ?? CB.spec.formats[0];
  const root = document.getElementById("cb-studio");
  root?.style.setProperty("--tw", String(current.trim[0]));
  root?.style.setProperty("--th", String(current.trim[1]));
  root?.style.setProperty("--bl", String(CB.bleedMm));
}
/** Dossier des modèles de dos pour ce format (les modèles d'origine sont au format poker). */
export const backDir = () => (current.key === "poker" ? "" : `${current.key}/`);
/** Largeur / hauteur du dos pleine page (fond perdu compris). */
export const backRatio = () => current.page[0] / current.page[1];
const px = (mm: number) => Math.round((mm / 25.4) * DPI);
export const pagePx = (): [number, number] => [px(current.page[0]), px(current.page[1])];
export const trimPx = (): [number, number] => [px(current.trim[0]), px(current.trim[1])];
