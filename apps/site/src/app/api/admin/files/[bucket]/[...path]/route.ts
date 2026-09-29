import { fail } from "@/lib/http.ts";
import { read } from "@/lib/storage.ts";

// Téléchargement des fichiers de production (lots SRA3, manifestes) : protégé par le middleware /admin.
export async function GET(_: Request, { params }: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path } = await params;
  if (!["production", "uploads"].includes(bucket)) return fail("Introuvable.", 404);
  try {
    const file = await read(bucket, path.join("/"));
    const name = path[path.length - 1];
    return new Response(file.body as BodyInit, { headers: { "Content-Type": file.type,
      "Content-Disposition": `attachment; filename="${name}"` } });
  } catch {
    return fail("Introuvable.", 404);
  }
}
