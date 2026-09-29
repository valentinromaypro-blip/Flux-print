import { fail } from "@/lib/http.ts";
import { sessionItem } from "@/lib/orders.ts";
import { readSession } from "@/lib/session.ts";
import { read } from "@/lib/storage.ts";

// Aperçus : {propriétaire}/{commande}/{ligne}/pN.png, visibles uniquement par la session propriétaire.
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const session = await readSession();
  const itemId = parts[2];
  if (!session || parts.length !== 4 || !itemId || !(await sessionItem(session, itemId))) return fail("Introuvable.", 404);
  try {
    const file = await read("previews", parts.join("/"));
    return new Response(file.body as BodyInit, { headers: { "Content-Type": file.type, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return fail("Introuvable.", 404);
  }
}
