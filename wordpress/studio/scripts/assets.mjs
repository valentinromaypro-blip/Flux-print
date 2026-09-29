// Copie dans le plugin les fichiers dont le studio a besoin, depuis le site (même source) :
// dessins des figures, modèles de dos et leurs polices, moteur et modèle de détourage.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const site = "../../apps/site/public", out = "../carte-blanche/assets";
cpSync(`${site}/cartes/dos`, `${out}/backs`, { recursive: true });
mkdirSync(`${out}/cards`, { recursive: true });
for (const f of readdirSync(`${site}/cartes`)) if (/\.(svg|json)$/.test(f)) copyFileSync(`${site}/cartes/${f}`, `${out}/cards/${f}`);
cpSync(`${site}/fonts/cartes`, `${out}/backs/fonts`, { recursive: true });

mkdirSync(`${out}/mediapipe`, { recursive: true });
const wasm = "node_modules/@mediapipe/tasks-vision/wasm";
for (const f of readdirSync(wasm)) if (f.startsWith("vision_wasm_internal")) copyFileSync(`${wasm}/${f}`, `${out}/mediapipe/${f}`);
const model = `${site}/models/selfie_multiclass_256x256.tflite`;
if (existsSync(model)) copyFileSync(model, `${out}/mediapipe/selfie_multiclass_256x256.tflite`);
else console.warn("modèle de détourage absent (lancer apps/site/tools/fetch-segmenter.mjs) : le studio utilisera un ovale");
console.log("assets copiés dans", out);
