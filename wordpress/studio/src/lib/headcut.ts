// Détourage de la tête (cheveux + visage) dans le navigateur, avec le modèle « selfie multiclass »
// de MediaPipe servi par le site (tools/fetch-segmenter.mjs). Le PNG détouré est ce qui est envoyé :
// l'aperçu et l'impression partent donc du même fichier. En cas d'échec : null (repli sur l'ovale).
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { CB } from "@/lib/env.ts";

const HAIR = 1, FACE = 3, MAX_SIDE = 1400;
let segmenter: Promise<ImageSegmenter> | null = null;

// Sources officielles publiques (même version que le moteur compilé dans le studio) : secours si
// les fichiers servis par le site ne se chargent pas. Seuls ces fichiers sont téléchargés ; les
// photos du client ne quittent jamais son navigateur.
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const CDN_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite";

function create(wasm: string, model: string): Promise<ImageSegmenter> {
  return import("@mediapipe/tasks-vision").then(async ({ FilesetResolver, ImageSegmenter }) =>
    ImageSegmenter.createFromOptions(await FilesetResolver.forVisionTasks(wasm), {
      baseOptions: { modelAssetPath: model, delegate: "CPU" },
      runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false,
    }));
}

function load(): Promise<ImageSegmenter> {
  const local = CB.mediapipe
    ? create(CB.mediapipe.replace(/\/$/, ""), CB.mediapipe + "selfie_multiclass_256x256.tflite")
    : Promise.reject(new Error("fichiers du site absents"));
  return (segmenter ??= local
    .catch((e) => { console.warn("détourage : fichiers du site indisponibles, sources publiques", e); return create(CDN_WASM, CDN_MODEL); })
    .catch((e) => { segmenter = null; throw e; })); // un échec (réseau) n'est pas définitif
}

/** Téléchargement du détourage en avance (dès l'étape des visages), sans attendre la première photo. */
export function warmup() {
  load().catch(() => {});
}

/** Raison du dernier échec du détourage (affichée dans le studio). */
export let cutError = "";

export async function cutHead(file: File): Promise<Blob | null> {
  cutError = "";
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const src = document.createElement("canvas"); src.width = w; src.height = h;
    const c = src.getContext("2d", { willReadFrequently: true })!;
    c.drawImage(bmp, 0, 0, w, h);
    const result = (await load()).segment(src);
    const masks = result.confidenceMasks!;
    const mw = masks[0].width, mh = masks[0].height;
    const hair = masks[HAIR].getAsFloat32Array(), face = masks[FACE].getAsFloat32Array();
    const img = c.getImageData(0, 0, w, h), d = img.data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, opaque = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const m = Math.min(mh - 1, Math.floor((y * mh) / h)) * mw + Math.min(mw - 1, Math.floor((x * mw) / w));
        const a = Math.max(0, Math.min(1, (hair[m] + face[m] - 0.35) / 0.3));
        d[(y * w + x) * 4 + 3] = Math.round(a * 255);
        if (a > 0.5) { opaque++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
    }
    masks.forEach((m) => m.close());
    if (opaque < 0.01 * w * h) { cutError = "aucun visage détecté sur cette photo"; return null; }
    c.putImageData(img, 0, 0);
    // Cadre serré sur la tête, marge de 4 %.
    const m = Math.round(0.04 * Math.max(x1 - x0, y1 - y0));
    const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m), bw = Math.min(w, x1 + m) - bx, bh = Math.min(h, y1 + m) - by;
    const out = document.createElement("canvas"); out.width = bw; out.height = bh;
    out.getContext("2d")!.drawImage(src, bx, by, bw, bh, 0, 0, bw, bh);
    return await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  } catch (e) {
    console.warn("détourage indisponible", e);
    cutError = "détourage indisponible (" + (e instanceof Error ? e.message : String(e)).slice(0, 120) + ")";
    return null;
  }
}
