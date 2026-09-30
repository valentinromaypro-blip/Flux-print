import { CB } from "@/lib/env.ts";

// Pas de jeton WordPress : l'API reconnaît le visiteur par son cookie de session Carte Blanche,
// ce qui reste valable même si la page est servie depuis un cache.
// Adresse de l'API : `CB.rest` vaut « …/wp-json/cb/v1/ » ou, sans permaliens, « …/?rest_route=/cb/v1/ ».
export function endpoint(path: string) {
  const [route, query] = path.split("?");
  return CB.rest + route + (query ? (CB.rest.includes("?") ? "&" : "?") + query : "");
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(endpoint(path), { credentials: "same-origin", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
  return body as T;
}
export const post = <T,>(path: string, body: BodyInit, type = "application/json") =>
  api<T>(path, { method: "POST", body, headers: { "Content-Type": type } });

