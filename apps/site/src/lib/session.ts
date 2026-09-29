import { cookies } from "next/headers";

// Session invité : jeton aléatoire signé (HMAC-SHA256), cookie httpOnly. Fonctionne en Node et en Workers.
const COOKIE = "cb_session";
const MAX_AGE = 60 * 60 * 24 * 90;

async function hmac(value: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET manquant ou trop court (32 caractères minimum).");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(sig).toString("base64url");
}

export async function readSession(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [token, sig] = raw.split(".");
  if (!token || !sig || (await hmac(token)) !== sig) return null;
  return /^[0-9a-f-]{36}$/.test(token) ? token : null;
}

/** Renvoie la session existante ou en crée une (à appeler depuis une route qui peut poser un cookie). */
export async function ensureSession(): Promise<string> {
  const existing = await readSession();
  if (existing) return existing;
  const token = crypto.randomUUID();
  (await cookies()).set(COOKIE, `${token}.${await hmac(token)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
  return token;
}
