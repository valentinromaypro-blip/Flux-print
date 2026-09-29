# Site Carte Blanche (Next.js)

Configurateur, dépôt et contrôle des fichiers, panier, paiement (test, Stripe, Revolut), suivi de commande et back-office atelier.
Documentation : `docs/05-site-et-back-office.md`.

```bash
cp .env.example .env.local   # puis compléter
npm install
npm test                     # tests des prix
npm run typecheck
npm run build && npm start
```

- `src/app/` : pages et routes d'API
- `src/lib/` : base, stockage, session, prix, catalogue, paiements, rapport de contrôle traduit pour le client
- `public/img/` : visuels (rendus de nos cartes, en attendant les photos de l'atelier)
- `tools/generate_visuals.py` : génération des visuels
- `prototype/` : maquette statique de la page d'accueil
