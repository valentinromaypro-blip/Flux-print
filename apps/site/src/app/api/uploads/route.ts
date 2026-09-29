import { getProduct } from "@/lib/catalog.ts";
import { body, fail, json, signPath } from "@/lib/http.ts";
import { ensureSession } from "@/lib/session.ts";
import { uploadTarget } from "@/lib/storage.ts";

const MAX_BYTES = 300 * 1024 * 1024;

/** Prépare le dépôt d'un PDF : renvoie l'adresse où le navigateur envoie le fichier. */
export async function POST(request: Request) {
  try {
    const { product, size } = await body<{ product: string; size: number }>(request);
    if (!(await getProduct(product))) return fail("Produit inconnu.", 404);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return fail("Fichier vide ou trop volumineux (300 Mo maximum).");
    const session = await ensureSession();
    const path = `sessions/${session}/${crypto.randomUUID()}.pdf`;
    return json({ path, target: await uploadTarget("uploads", path, await signPath(path)) });
  } catch (e) {
    return fail((e as Error).message);
  }
}
