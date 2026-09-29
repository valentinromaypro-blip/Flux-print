import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import CartLink from "@/components/CartLink";

export const metadata: Metadata = {
  title: "Carte Blanche · Jeux de cartes personnalisés imprimés en France",
  description: "Créez votre jeu de cartes, votre oracle ou votre jeu de famille. Contrôle du fichier en direct, aperçu avant paiement, fabrication dans notre atelier.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div className="announce">Imprimé et façonné dans notre atelier en France · Vous voyez vos cartes avant de payer</div>
        <header className="site-header">
          <div className="container nav">
            <Link className="logo" href="/">Carte <span>Blanche</span></Link>
            <nav className="menu" aria-label="Navigation principale">
              <Link href="/#jeux">Nos jeux</Link>
              <Link href="/creer/oracle">Oracles</Link>
              <Link href="/#occasions">Occasions</Link>
              <Link href="/#comment">Comment ça marche</Link>
            </nav>
            <div className="tools"><CartLink /></div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container">
            <div className="foot">
              <div><span className="logo">Carte <span>Blanche</span></span>
                <p className="muted" style={{ marginTop: 12, maxWidth: "34ch" }}>Jeux de cartes et oracles personnalisés, imprimés et façonnés dans notre atelier en France.</p></div>
              <div><h4>Nos jeux</h4><ul><li><Link href="/creer/jeu-poker-54">Jeu classique</Link></li><li><Link href="/creer/jeu-poker-54-dos-individuels">Jeu photo</Link></li><li><Link href="/creer/oracle">Oracle</Link></li><li><Link href="/creer/jeu-poker-32">Belote</Link></li></ul></div>
              <div><h4>Aide</h4><ul><li><Link href="/#comment">Comment ça marche</Link></li><li><Link href="/panier">Mon panier</Link></li><li>Livraison</li><li>Contact</li></ul></div>
              <div><h4>Maison</h4><ul><li>L&apos;atelier</li><li>CGV</li><li>Mentions légales</li><li>Confidentialité</li></ul></div>
            </div>
            <div className="legal"><span>© 2026 Carte Blanche · prix affichés fictifs (maquette)</span><span>Paiement sécurisé</span></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
