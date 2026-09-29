import { NextResponse, type NextRequest } from "next/server";

// Back-office : accès protégé par mot de passe (ADMIN_PASSWORD), en attendant des comptes équipe.
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return new NextResponse("Back-office désactivé (ADMIN_PASSWORD non défini).", { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, given] = atob(encoded).split(":");
    if (given === password) return NextResponse.next();
  }
  return new NextResponse("Authentification requise.", { status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Carte Blanche atelier"' } });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
