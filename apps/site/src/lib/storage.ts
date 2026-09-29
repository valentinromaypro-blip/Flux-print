// Stockage des fichiers : même organisation en buckets que le worker Python
// (uploads, previews, production, templates). « local:/chemin » en développement,
// Supabase Storage en production (API HTTP, compatible Cloudflare Workers).

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

function mode(): { kind: "local"; root: string } | { kind: "supabase"; url: string; key: string } {
  const storage = process.env.FLUX_STORAGE ?? "supabase";
  if (storage.startsWith("local:")) return { kind: "local", root: storage.slice("local:".length) };
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.");
  return { kind: "supabase", url: url.replace(/\/$/, ""), key };
}

export function safePath(path: string): string {
  if (!/^[\w\-./]+$/.test(path) || path.includes("..") || path.startsWith("/")) throw new Error("Chemin invalide.");
  return path;
}

async function localFile(bucket: string, path: string) {
  const { resolve, join } = await import("node:path");
  const m = mode() as { root: string };
  const root = resolve(/*turbopackIgnore: true*/ m.root, bucket);
  const full = resolve(/*turbopackIgnore: true*/ join(root, safePath(path)));
  if (!full.startsWith(root)) throw new Error("Chemin invalide.");
  return full;
}

/** Adresse où le navigateur envoie directement le fichier (sans passer par le serveur en production). */
export async function uploadTarget(bucket: string, path: string, localToken: string): Promise<UploadTarget> {
  const m = mode();
  if (m.kind === "local") {
    return { url: `/api/uploads/local?path=${encodeURIComponent(path)}&token=${localToken}`, method: "PUT",
      headers: { "Content-Type": "application/pdf" } };
  }
  const res = await fetch(`${m.url}/storage/v1/object/upload/sign/${bucket}/${safePath(path)}`, {
    method: "POST", headers: { Authorization: `Bearer ${m.key}`, apikey: m.key },
  });
  if (!res.ok) throw new Error(`Supabase Storage : ${res.status}`);
  const { url } = (await res.json()) as { url: string };
  return { url: `${m.url}/storage/v1${url}`, method: "PUT", headers: { "Content-Type": "application/pdf" } };
}

export async function putLocal(bucket: string, path: string, body: ReadableStream<Uint8Array>, maxBytes: number) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const full = await localFile(bucket, path);
  await mkdir(dirname(full), { recursive: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new Error("Fichier trop volumineux.");
    chunks.push(value);
  }
  await writeFile(full, Buffer.concat(chunks));
  return size;
}

export async function exists(bucket: string, path: string): Promise<boolean> {
  const m = mode();
  if (m.kind === "local") {
    const { stat } = await import("node:fs/promises");
    return stat(await localFile(bucket, path)).then(() => true, () => false);
  }
  const res = await fetch(`${m.url}/storage/v1/object/info/${bucket}/${safePath(path)}`, {
    headers: { Authorization: `Bearer ${m.key}`, apikey: m.key },
  });
  return res.ok;
}

/** Contenu d'un fichier (aperçus, gabarits, lots pour l'atelier). */
export async function read(bucket: string, path: string): Promise<{ body: ReadableStream | Uint8Array; type: string }> {
  const type = path.endsWith(".png") ? "image/png" : path.endsWith(".json") ? "application/json" : "application/pdf";
  const m = mode();
  if (m.kind === "local") {
    const { readFile } = await import("node:fs/promises");
    return { body: new Uint8Array(await readFile(await localFile(bucket, path))), type };
  }
  const res = await fetch(`${m.url}/storage/v1/object/${bucket}/${safePath(path)}`, {
    headers: { Authorization: `Bearer ${m.key}`, apikey: m.key },
  });
  if (!res.ok || !res.body) throw new Error(`Fichier introuvable : ${bucket}/${path}`);
  return { body: res.body, type };
}
