import postgres from "postgres";

// Connexion Postgres partagée (Supabase en production ; en Cloudflare Workers, via Hyperdrive).
const globalRef = globalThis as unknown as { __fluxSql?: postgres.Sql };

export function sql(): postgres.Sql {
  if (!globalRef.__fluxSql) {
    const url = process.env.FLUX_DATABASE_URL;
    if (!url) throw new Error("FLUX_DATABASE_URL manquant.");
    globalRef.__fluxSql = postgres(url, { max: 5, idle_timeout: 20, prepare: false });
  }
  return globalRef.__fluxSql;
}
