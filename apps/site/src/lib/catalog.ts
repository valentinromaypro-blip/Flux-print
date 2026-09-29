import { sql } from "./db.ts";
import type { Product } from "./types.ts";

export async function listProducts(): Promise<Product[]> {
  const rows = await sql()<Product[]>`
    select code, label, page_count, shop, options, media, templates, editor
      from public.products where active order by (shop->>'order')::int nulls last, code`;
  return rows;
}

export async function getProduct(code: string): Promise<Product | null> {
  const [row] = await sql()<Product[]>`
    select code, label, page_count, shop, options, media, templates, editor
      from public.products where code = ${code} and active`;
  return row ?? null;
}

/** Valide et complète les options choisies par le client, comme le moteur (load_item_spec). */
export function cleanOptions(product: Product, input: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, spec] of Object.entries(product.options)) {
    const value = input[key] ?? spec.default;
    if (spec.kind === "number") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < (spec.min ?? n) || n > (spec.max ?? n)) throw new Error(`${spec.label} invalide.`);
      out[key] = n;
    } else {
      if (typeof value !== "string" || !(value in (spec.choices ?? {}))) throw new Error(`${spec.label} invalide.`);
      out[key] = value;
    }
  }
  return out;
}

export function templateKey(product: Product, options: Record<string, string | number>): string {
  return typeof options.format === "string" && product.templates[options.format] ? options.format : "default";
}
