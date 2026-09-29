import { fail } from "@/lib/http.ts";
import { read } from "@/lib/storage.ts";

// Fichiers pour l'atelier (lots SRA3, PDF d'impression, fichiers clients, aperçus) : protégé par le proxy /admin.
export async function GET(_: Request, { params }: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await params;
  if (!["production", "uploads", "previews"].includes(bucket)) return fail("Introuvable.", 404);
  try {
    const file = await read(bucket, path.join("/"));
    const name = path[path.length - 1];
    return new Response(file.body as BodyInit, { headers: { "Content-Type": file.type,
      "Content-Disposition": `${file.type.startsWith("image/") ? "inline" : "attachment"}; filename="${name}"` } });
  } catch {
    return fail("Introuvable.", 404);
  }
}
