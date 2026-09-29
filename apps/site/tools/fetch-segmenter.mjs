// Détourage des visages dans le navigateur (MediaPipe, Apache-2.0) : copie le moteur WASM dans
// public/mediapipe et télécharge le modèle « selfie multiclass » (cheveux, visage, corps, fond)
// dans public/models. Servis par notre site : aucun appel à un service tiers chez le client.
// Sans ces fichiers, l'éditeur retombe sur un ovale (même rendu côté moteur).
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";

const wasm = "node_modules/@mediapipe/tasks-vision/wasm";
mkdirSync("public/mediapipe", { recursive: true });
for (const f of readdirSync(wasm)) if (f.startsWith("vision_wasm_internal")) copyFileSync(`${wasm}/${f}`, `public/mediapipe/${f}`);

const model = "public/models/selfie_multiclass_256x256.tflite";
const url = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
if (!existsSync(model)) {
  mkdirSync("public/models", { recursive: true });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
    console.log("modèle de détourage téléchargé");
  } catch (e) {
    console.warn(`modèle de détourage indisponible (${e.message}) : l'éditeur utilisera un ovale`);
  }
}
