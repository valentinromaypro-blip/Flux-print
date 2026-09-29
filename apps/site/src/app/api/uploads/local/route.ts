import { fail, json, signPath } from "@/lib/http.ts";
import { putLocal } from "@/lib/storage.ts";

// Réception directe des fichiers en développement (stockage local). En production,
// le navigateur envoie le fichier directement à Supabase Storage.
export async function PUT(request: Request) {
  if (!(process.env.FLUX_STORAGE ?? "").startsWith("local:")) return fail("Indisponible.", 404);
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  if (url.searchParams.get("token") !== (await signPath(path))) return fail("Lien de dépôt invalide.", 403);
  if (!request.body) return fail("Fichier manquant.");
  try {
    const size = await putLocal("uploads", path, request.body, 300 * 1024 * 1024);
    return json({ ok: true, size });
  } catch (e) {
    return fail((e as Error).message);
  }
}
