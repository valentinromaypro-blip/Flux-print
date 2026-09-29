# Site et back-office : WordPress/WooCommerce ou sur mesure ?

## Réponse : sur mesure, sans WordPress

WooCommerce apporterait un tableau de bord tout fait. Mais dans notre cas, il nous coûterait plus qu'il ne rapporte.

| Critère | WordPress + WooCommerce | Sur mesure (Next.js + Supabase) |
|---|---|---|
| Configurateur, dépôt de PDF, contrôle en direct | À développer quand même, sous forme d'extension PHP | Déjà construit |
| Chaîne de production (worker, lots SRA3, Fiery) | Branchement fragile : la commande WooCommerce doit être recopiée dans notre base | Même base, même modèle de données, aucune synchronisation |
| Tableau de bord | Générique : commandes, clients, stocks | Orienté atelier : fichiers à contrôler, lots SRA3, remplissage des feuilles, téléchargements |
| Autonomie (décision D5) | Dépendance à des dizaines d'extensions et à leurs mises à jour | Tout le code nous appartient |
| Sécurité et maintenance | Surface d'attaque importante, mises à jour permanentes | Peu de dépendances (Next, React, postgres) |
| Hébergement | Serveur PHP à maintenir | Cloudflare + Supabase, déjà choisis |
| Plusieurs sites mono-produit | Un WordPress par site ou multisite, lourd | Un seul code, une vitrine par configuration |
| Ce qu'on perd | Extensions prêtes à l'emploi : avis, codes promo, e-mails, SEO | À construire au fil de l'eau (voir la feuille de route ci-dessous) |

**Ce qu'on reprend à l'extérieur :**
- les **remboursements et litiges** se gèrent dans les tableaux de bord de Stripe ou de Revolut ;
- la **facturation électronique** (obligatoire en réception depuis septembre 2026) passe par un outil de facturation certifié, branché par API, plutôt que d'être refaite chez nous.

## Ce qui est construit (`apps/site`)

| Page ou route | Rôle |
|---|---|
| `/` | Accueil : produits et prix « à partir de », lus dans la base |
| `/creer/[produit]` | Configurateur : options (format, nombre de cartes, dos), carton, quantité, prix en direct avec dégressif, gabarit, dépôt du PDF, contrôle en direct traduit pour le client, aperçus |
| `/panier` | Lignes et état des fichiers, quantités, adresse, paiement (ouvert seulement si tous les fichiers sont validés) |
| `/commande/[n°]` | Suivi : payée → préparée → imprimée → expédiée |
| `/admin` | Atelier (protégé par mot de passe) : indicateurs, lots SRA3 avec téléchargement du PDF et du manifeste, commandes |
| `/api/webhooks/stripe`, `/api/webhooks/revolut` | Confirmation des paiements (signature vérifiée, montant contrôlé, idempotent) |

**Paiement :** le prestataire se choisit par `PAYMENT_PROVIDER=test|stripe|revolut`.
- **Test :** simulation, utilisée en développement.
- **Stripe :** Checkout hébergé.
- **Revolut :** API Merchant, page de paiement Revolut. À valider en bac à sable avec vos clés.

**Sécurité :**
- **Prix :** toujours recalculés côté serveur au moment du paiement. Un paiement n'est accepté que si le montant encaissé correspond exactement au total.
- **Sessions invités :** cookie signé.
- **Aperçus :** visibles uniquement par la session propriétaire.
- **Dépôt des fichiers :** par lien signé.

## Test de bout en bout réalisé

Navigateur réel (Chromium), base PostgreSQL avec les migrations Supabase, worker en marche :
1. Oracle de 30 cartes au format tarot : dépôt, contrôle « prêt à imprimer », aperçus, ajout au panier.
2. Jeu de 54 cartes défectueux : refusé avec des messages clairs (fond perdu manquant sur 55 cartes, image à 90 ppi sur la Dame de pique, texte trop près du bord).
3. Panier, adresse, paiement de test, commande FP-1000 payée.
4. Worker : conversion CMJN, puis lot SRA3 PDF/X-4 de 10 cartes par feuille. `flux-print dispatch --check-only` confirme que le lot est prêt pour le Fiery.
5. Back-office : lot et commande visibles. Le téléchargement exige le mot de passe (401 sans).

## Lancer en local

```bash
# 1. Base : appliquer supabase/tests/supabase_stubs.sql puis supabase/migrations/*.sql
# 2. Catalogue et gabarits
FLUX_DATABASE_URL=... FLUX_STORAGE=local:$PWD/var/storage flux-print sync-catalog
# 3. Worker
FLUX_DATABASE_URL=... FLUX_STORAGE=local:$PWD/var/storage flux-print worker
# 4. Site (copier .env.example en .env.local)
cd apps/site && npm install && npm run build && npm start
```

## Feuille de route du site

1. **Photos réelles** des jeux imprimés à la place des rendus, et maquettes 3D (étui, éventail) générées depuis le fichier du client.
2. **E-mails transactionnels :** confirmation, fichier refusé, expédition.
3. **Livraison :** tarifs, transporteurs, étiquettes.
4. **Création en ligne sans fichier :** modèles plus éditeur (visage sur les figures, prénoms).
5. **Back-office :** fiche commande détaillée, relance d'un fichier, lancement manuel d'un lot, comptes équipe.
6. **Codes promo, avis clients, SEO** (pages par occasion).
7. **Mise en ligne :** Cloudflare Workers (OpenNext) avec connexion Postgres via Hyperdrive, Supabase de production, clés de paiement.
