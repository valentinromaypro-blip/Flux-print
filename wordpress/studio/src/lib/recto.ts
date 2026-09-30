// Modèles de recto : le dessin de chaque carte selon le modèle choisi, pour l'aperçu comme pour
// l'impression (même code, à la taille voulue). Figures en unités de la carte (240 × 336).
import type { Crop } from "@/lib/design.ts";
import { asset } from "@/lib/env.ts";
import { drawCourt, type Face, loadImage, type Style, vintage } from "@/lib/cardrender.ts";

export type Model = "classique" | "vintage";
export const MODELS: { id: Model; label: string; hint: string; style: Style }[] = [
  { id: "classique", label: "Classique", hint: "Les figures traditionnelles, votre visage à la place du leur.", style: "couleur" },
  { id: "vintage", label: "Vintage", hint: "Papier crème et encres passées sur tout le jeu, visages en sépia.", style: "sepia" },
];
export const STYLES: [Style, string][] = [["couleur", "Photo couleur"], ["gravure", "Gravure bleue"], ["nb", "Noir et blanc"], ["sepia", "Sépia"]];

/** Cartes du jeu, dans l'ordre de l'atelier (CB_Production::codes). */
export function deckCodes(deck: string): string[] {
  const ranks = deck === "32" ? ["A", "7", "8", "9", "10", "J", "Q", "K"] : ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const codes = ["S", "H", "D", "C"].flatMap((s) => ranks.map((r) => `${s}-${r}`));
  return deck === "32" ? codes : [...codes, "JK-1", "JK-2"];
}
export const isCourt = (code: string) => /-[JQK]$/.test(code);

/** Cadrage de départ d'une photo posée sur une figure. */
export const startCrop = (face: Face): Crop => (face.cut ? { zoom: 1, x: 0.5, y: 0.5 } : { zoom: 2.2, x: 0.5, y: 0.38 });

/** Face standard classique (aperçu), rognée au format fini (le fichier comprend 3 mm de fond perdu). */
async function drawStandard(target: HTMLCanvasElement, code: string) {
  const img = await loadImage(asset(`../engine/fronts/${code}.jpg`));
  const bx = (img.naturalWidth * 3) / 69.5, by = (img.naturalHeight * 3) / 94.9;
  target.getContext("2d")!.drawImage(img, bx, by, img.naturalWidth - 2 * bx, img.naturalHeight - 2 * by, 0, 0, target.width, target.height);
}

/**
 * Une carte du jeu dans le modèle choisi. `face` : la photo posée sur la figure (ou null).
 * Les cartes non figures sont les cartes standard de l'atelier (teintées en vintage, comme à l'atelier).
 */
export async function drawCard(target: HTMLCanvasElement, model: Model, code: string, face: Face | null, crop: Crop, style: Style) {
  if (isCourt(code)) await drawCourt(target, code, face, crop, style);
  else await drawStandard(target, code);
  if (model === "vintage") vintage(target.getContext("2d", { willReadFrequently: true })!, target.width, target.height);
}
