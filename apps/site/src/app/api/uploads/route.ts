import { getProduct } from "@/lib/catalog.ts";
import { body, fail, json, signPath } from "@/lib/http.ts";
import { ensureSession } from "@/lib/session.ts";
import { uploadTarget } from "@/lib/storage.ts";

const MAX_BYTES = 300 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Prépare le dépôt d'un PDF : renvoie l'adresse où le navigateur envoie le fichier. */
export async function POST(request: Request) {
  try {
    const { product, size, kind, type } = await body<{ product: string; size: number; kind?: "pdf" | "photo"; type?: string }>(request);
    if (!(await getProduct(product))) return fail("Produit inconnu.", 404);
    const session = await ensureSession();
    if (kind === "photo") {
      const ext = PHOTO_TYPES[type ?? ""];
      if (!ext) return fail("Photo au format JPEG, PNG ou WebP.");
      if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) return fail("Photo vide ou trop lourde (25 Mo maximum).");
      const path = `sessions/${session}/photos/${crypto.randomUUID()}.${ext}`;
      return json({ path, target: await uploadTarget("uploads", path, await signPath(path), type) });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return fail("Fichier vide ou trop volumineux (300 Mo maximum).");
    const path = `sessions/${session}/${crypto.randomUUID()}.pdf`;
    return json({ path, target: await uploadTarget("uploads", path, await signPath(path)) });
  } catch (e) {
    return fail((e as Error).message);
  }
}
