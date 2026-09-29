import { getProduct } from "@/lib/catalog.ts";
import { fail } from "@/lib/http.ts";
import { read } from "@/lib/storage.ts";

export async function GET(_: Request, { params }: { params: Promise<{ product: string; format: string }> }) {
  const { product: code, format } = await params;
  const product = await getProduct(code);
  const path = product?.templates[format];
  if (!path) return fail("Gabarit introuvable.", 404);
  const file = await read("templates", path);
  return new Response(file.body as BodyInit, {
    headers: { "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="gabarit-${code}-${format}.pdf"`, "Cache-Control": "public, max-age=3600" },
  });
}
