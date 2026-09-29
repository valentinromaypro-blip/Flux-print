import Link from "next/link";
import { listProducts } from "@/lib/catalog.ts";
import { formatEuros, fromPrice } from "@/lib/pricing.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const products = await listProducts();
  return (
    <>
      <div className="container hero">
        <div>
          <h1>Votre jeu.<br /><em>Vos règles.</em></h1>
          <p className="sub">Jeux de cartes, jeux de famille et oracles à votre image. Vous déposez votre fichier, on le contrôle en direct, vous voyez tout avant de payer.</p>
          <div className="actions">
            <Link className="btn red" href="/creer/jeu-poker-54">Créer mon jeu →</Link>
            <Link className="link" href="#comment">Voir comment ça marche</Link>
          </div>
          <div className="promise"><span>Contrôle du fichier en direct</span><span>Carton 350 g</span><span>Fabriqué en France</span></div>
        </div>
        <figure><img src="/img/scene-hero.jpg" alt="Éventail de cartes Carte Blanche sur un tapis vert, avec leur étui." /></figure>
      </div>

      <section className="section container" id="jeux">
        <div className="head"><h2>Choisissez votre jeu</h2><p>Tout se personnalise ensuite : format, carton, dos, figures, nombre de cartes.</p></div>
        <div className="products">
          {products.map((p) => (
            <Link className="product" href={`/creer/${p.code}`} key={p.code}>
              {p.code === "jeu-poker-54-dos-individuels" && <span className="badge">Le plus offert</span>}
              <div className="ph"><img src={`/img/${p.shop.image}.jpg`} alt="" /></div>
              <div className="meta"><h3>{p.shop.title}</h3>
                <span className="price"><small>dès </small>{formatEuros(fromPrice(p.shop.pricing, Number(p.options.cards?.default ?? 0) || undefined))}</span></div>
              <p>{p.shop.tagline}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="container">
        <div className="feature">
          <img src="/img/scene-oracle.jpg" alt="Cartes oracle au format tarot : la Lune, le Soleil, l'Étoile." />
          <div className="txt">
            <h2>Votre oracle, de 22 à 100 cartes</h2>
            <p>Format tarot ou poker, chaque carte unique, coins arrondis. Vous choisissez le nombre de cartes, le prix s&apos;ajuste en direct.</p>
            <div><Link className="btn" href="/creer/oracle">Créer mon oracle</Link></div>
          </div>
        </div>
      </section>

      <section className="section container" id="occasions">
        <div className="head"><h2>Pour chaque occasion</h2></div>
        <div className="occasions">
          {[["mariage", "Mariage"], ["anniversaire", "Anniversaire"], ["evjf", "EVJF"], ["entreprise", "Entreprise"]].map(([k, l]) => (
            <Link className="occ" href="/creer/jeu-poker-54" key={k}><img src={`/img/occasion-${k}.jpg`} alt={`Dos personnalisé ${l}`} /><span>{l}</span></Link>
          ))}
        </div>
      </section>

      <section className="section container" id="comment" style={{ paddingTop: 0 }}>
        <div className="head"><h2>Trois étapes, et vous voyez tout avant de payer</h2></div>
        <div className="products">
          <div className="product"><div className="ph"><img src="/img/scene-etui.jpg" alt="" /></div><h3>1. Choisissez</h3><p>Format, carton, nombre de cartes et quantité : le prix s&apos;affiche en direct.</p></div>
          <div className="product"><div className="ph"><img src="/img/scene-detail.jpg" alt="" /></div><h3>2. Déposez votre fichier</h3><p>Partez de notre gabarit. On contrôle votre PDF en quelques secondes et on vous dit quoi corriger, carte par carte.</p></div>
          <div className="product"><div className="ph"><img src="/img/scene-famille.jpg" alt="" /></div><h3>3. Vérifiez et commandez</h3><p>Aperçu de vos cartes, puis paiement. On imprime dans notre atelier.</p></div>
        </div>
      </section>

      <section className="container">
        <div className="cta-band"><h2>Donnez-vous carte blanche.</h2><div><Link className="btn light" href="/creer/jeu-poker-54">Créer mon jeu →</Link></div></div>
      </section>
    </>
  );
}
