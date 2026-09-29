import type { Finding, PreflightReport } from "./types.ts";

// Traduction du rapport technique du moteur en messages clairs pour le client.
export type CustomerMessage = {
  level: "error" | "warning" | "ok";
  title: string;
  help: string;
  cards: string[];
};

const COPY: Record<string, { title: string; help: string } | ((f: Finding) => { title: string; help: string })> = {
  "file.unreadable": { title: "Ce fichier n'est pas un PDF lisible", help: "Exportez votre création en PDF depuis votre logiciel, puis déposez-la à nouveau." },
  "file.encrypted": { title: "Le PDF est protégé par un mot de passe", help: "Exportez-le sans protection." },
  "pages.count": (f) => ({ title: "Le nombre de pages ne correspond pas", help: f.message }),
  "geometry.bleed": { title: "Il manque le fond perdu", help: "Prolongez votre fond de 3 mm au-delà du bord de chaque carte, comme indiqué en rose sur le gabarit." },
  "geometry.page_size": (f) => ({ title: "Le format des pages n'est pas le bon", help: f.message + " Partez de notre gabarit." }),
  "geometry.trim_size": (f) => ({ title: "Le format des pages n'est pas le bon", help: f.message + " Partez de notre gabarit." }),
  "geometry.orientation": { title: "Des pages sont à l'horizontale", help: "Les cartes doivent être en portrait (à la verticale)." },
  "geometry.trim_inferred": (f) => ({ title: "Format déduit automatiquement", help: f.message }),
  "image.resolution": (f) => f.severity === "error"
    ? { title: "Une image est trop pixelisée", help: `Elle fait ${Math.round(Number(f.details.ppi))} ppi à la taille d'impression : il faut au moins 150 ppi. Utilisez une image plus grande.` }
    : { title: "Une image est un peu légère", help: `${Math.round(Number(f.details.ppi))} ppi : elle sera imprimée, mais moins nette. Remplacez-la si vous avez mieux (300 ppi idéalement).` },
  "font.not_embedded": (f) => ({ title: "Une police n'est pas incorporée", help: `La police « ${String(f.details.font)} » manque. Exportez en incorporant les polices, ou vectorisez le texte.` }),
  "text.safe_zone": { title: "Du texte est trop près du bord", help: "Il risque d'être coupé. Gardez vos textes à l'intérieur de la ligne pointillée du gabarit (4 mm du bord)." },
  "content.guide_marks": { title: "Les repères du gabarit sont encore visibles", help: "Masquez le calque du gabarit avant d'exporter votre PDF." },
  "content.hairline": { title: "Des traits sont très fins", help: "En dessous de 0,25 pt, ils risquent de disparaître à l'impression." },
  "content.overprint": { title: "Surimpression activée", help: "Vérifiez qu'elle est volontaire : certaines couleurs pourraient disparaître." },
  "content.annotations": { title: "Le PDF contient des annotations", help: "Elles ne seront pas imprimées." },
  "color.rgb": { title: "Couleurs en RVB", help: "Nous les convertissons en CMJN pour l'impression : les couleurs très vives peuvent être légèrement moins éclatantes." },
  "color.spot": { title: "Couleurs Pantone non prévues", help: "Ce produit s'imprime en quadrichromie. Convertissez vos couleurs spéciales en CMJN." },
  "color.lab": { title: "Couleurs Lab", help: "Elles seront converties en CMJN." },
  "ink.tac": { title: "Des zones sont très chargées en encre", help: "Elles risquent de maculer. Éclaircissez légèrement les aplats très sombres." },
};

export function customerMessages(report: PreflightReport | null): CustomerMessage[] {
  if (!report) return [];
  const byCode = new Map<string, CustomerMessage>();
  for (const f of report.findings) {
    if (f.severity === "info") continue;
    const entry = COPY[f.code];
    const copy = typeof entry === "function" ? entry(f) : entry ?? { title: f.message, help: "" };
    const key = `${f.code}:${f.severity}`;
    const msg = byCode.get(key) ?? { level: f.severity === "error" ? "error" : "warning", ...copy, cards: [] };
    const label = typeof f.details.page_label === "string" ? f.details.page_label.replace(/^Face — /, "") : null;
    if (label && !msg.cards.includes(label)) msg.cards.push(label);
    byCode.set(key, msg);
  }
  const list = [...byCode.values()].sort((a, b) => (a.level === "error" ? -1 : 1) - (b.level === "error" ? -1 : 1));
  if (report.passed) list.unshift({ level: "ok", title: "Votre fichier est prêt à imprimer", help: `${report.page_count} pages contrôlées : format, fond perdu, images et polices.`, cards: [] });
  return list;
}
