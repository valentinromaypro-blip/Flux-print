// Détourage de la tête (cheveux + visage) dans le navigateur, avec le modèle « selfie multiclass »
// de MediaPipe servi par le site (tools/fetch-segmenter.mjs). Le PNG détouré est ce qui est envoyé :
// l'aperçu et l'impression partent donc du même fichier. En cas d'échec : null (repli sur l'ovale).
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { CB } from "@/lib/env.ts";

const HAIR = 1, FACE = 3, MAX_SIDE = 1400;
let segmenter: Promise<ImageSegmenter> | null = null;

function load(): Promise<ImageSegmenter> {
  // Fichiers servis par le site (installés par le plugin) ; absents : repli sur l'ovale
  if (!CB.mediapipe) return Promise.reject(new Error("Détourage pas encore installé"));
  return (segmenter ??= import("@mediapipe/tasks-vision").then(async ({ FilesetResolver, ImageSegmenter }) =>
    ImageSegmenter.createFromOptions(await FilesetResolver.forVisionTasks(CB.mediapipe.replace(/\/$/, "")), {
      baseOptions: { modelAssetPath: CB.mediapipe + "selfie_multiclass_256x256.tflite", delegate: "CPU" },
      runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false,
    })));
}

export async function cutHead(file: File): Promise<Blob | null> {
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
    if (opaque < 0.01 * w * h) return null; // pas de visage trouvé
    c.putImageData(img, 0, 0);
    // Cadre serré sur la tête, marge de 4 %.
    const m = Math.round(0.04 * Math.max(x1 - x0, y1 - y0));
    const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m), bw = Math.min(w, x1 + m) - bx, bh = Math.min(h, y1 + m) - by;
    const out = document.createElement("canvas"); out.width = bw; out.height = bh;
    out.getContext("2d")!.drawImage(src, bx, by, bw, bh, 0, 0, bw, bh);
    return await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  } catch (e) {
    console.warn("détourage indisponible", e);
    return null;
  }
}
