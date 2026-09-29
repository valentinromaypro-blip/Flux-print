import { sql } from "@/lib/db.ts";

/** Demande au worker de lancer tout de suite un lot avec les jeux prêts (protégé par le proxy /api/admin). */
export async function POST(request: Request) {
  await sql()`insert into public.batch_requests (requested_by) values ('atelier')`;
  return Response.redirect(new URL("/admin?lot=demande", request.url), 303);
}
