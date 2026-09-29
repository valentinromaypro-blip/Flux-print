# Chaîne commande → fichier de production

Périmètre actuel : de la commande client jusqu'au **lot SRA3 PDF/X-4 généré et stocké**. Le dépôt automatique dans le Fiery (`flux-print dispatch`) sera branché ensuite.

## 1. Architecture

```
            Cloudflare                                Supabase
┌──────────────────────────────┐        ┌───────────────────────────────────┐
│ Site (à venir)               │  API   │ Postgres : products, orders,      │
│ - dépôt du PDF client        ├───────►│   order_items, batches, events    │
│ - suivi du contrôle en direct│        │ Storage : uploads, previews,      │
│ - paiement (Stripe)          │        │   production                      │
└──────────────────────────────┘        │ Auth : comptes + invités anonymes │
                                        └──────────────▲────────────────────┘
                                                       │ le worker va chercher le travail
                                        ┌──────────────┴────────────────────┐
                                        │ Worker Python (atelier ou cloud)  │
                                        │ flux-print worker                 │
                                        └───────────────────────────────────┘
```

C'est le worker qui interroge la base, pas l'inverse. Il peut tourner à l'atelier sans ouvrir de port, et plusieurs workers peuvent tourner en parallèle : la réservation des lignes est atomique (`claim_items`, `FOR UPDATE SKIP LOCKED`).

## 2. États

**Ligne de commande** (un fichier client pour un produit, avec son support et son nombre d'exemplaires) :

```
uploaded ─► checking ─► approved ──(commande payée)──► preparing ─► prepared ─► batched
                    └─► rejected                                          (lot SRA3 généré)
tout état ─► failed (erreur technique, reprise manuelle)
```

**Commande** : `draft → awaiting_payment → paid → in_production` (toutes ses lignes en lot) `→ printed → shipped`.

**Lot** : `generating → generated` (`→ dispatched → printed` avec le lien Fiery). En cas d'échec, `failed` : ses lignes redeviennent `prepared` et repartiront dans le lot suivant.

## 3. Étapes du worker

| Étape | Entrée | Traitement | Sortie |
|---|---|---|---|
| Contrôle | `uploaded` | preflight complet (y compris l'encre avec le profil de la presse), aperçus PNG des 2 premières pages | `approved` ou `rejected` + rapport JSON + aperçus |
| Préparation | `approved`, commande payée | boîtes PDF, conversion CMJN FOGRA51 | `prepared` + `production/items/{id}.pdf` |
| Amalgame | `prepared` | regroupement par clé d'amalgame, décision de lancement, imposition SRA3, PDF/X-4, manifeste | `batched` + `production/batches/{lot}.pdf` et `.json` |

**Quand un lot part-il ?** Règles dans `config/production.toml` :
- remplissage des feuilles ≥ 90 % ;
- ou ligne la plus ancienne en attente depuis 24 h ;
- ou commande à expédier dans 2 jours ou moins ;
- ou lancement forcé (`--force-batches`).

**Qu'est-ce qu'on regroupe ?** Tous les produits qui partagent la clé d'amalgame (support, format, fond perdu, recto/verso). Un jeu de 54 et un jeu de 32 au format poker, tous deux sur le 350 g cmdm, partagent un lot. Deux supports différents, jamais.

## 4. Sécurité (RLS Supabase, testée)

- Un client (connecté ou invité anonyme) ne voit que ses commandes, ses lignes et ses fichiers.
- Il crée des commandes uniquement à l'état `draft`, à 0 €, sans référence de paiement : le passage à « payé » vient exclusivement du serveur (webhook Stripe).
- Lots, journal et bucket `production` : aucun accès client.
- Le worker se connecte avec le rôle propriétaire de la base.

## 5. Mise en route

```bash
# Base : appliquer supabase/migrations/*.sql (supabase db push, ou éditeur SQL)
export FLUX_DATABASE_URL="postgresql://postgres:…@db.<projet>.supabase.co:5432/postgres"
export SUPABASE_URL="https://<projet>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="…"        # secret : jamais dans le dépôt ni côté navigateur

flux-print sync-catalog                     # publie config/products dans la table products
flux-print worker                           # boucle (toutes les 30 s)
flux-print worker --once [--force-batches]  # un passage

# Développement sans site ni Supabase : Postgres local + stockage disque
export FLUX_STORAGE=local:./var/storage
flux-print dev-order --product jeu-poker-54 --copies 2 --paid fichier.pdf
```

## 6. Tests

`tests/test_order_pipeline.py` exécute la chaîne réelle sur PostgreSQL avec les migrations Supabase : chaîne complète jusqu'au SRA3 prêt pour le Fiery, fichier refusé, commande non payée, attente de remplissage puis amalgame de plusieurs commandes et produits, supports séparés, commande urgente, échec de génération et reprise.

`supabase/tests/rls_test.sql` vérifie le cloisonnement entre clients et la réservation atomique.

## 7. Point d'attention pour le site

Le paiement doit intervenir **après** l'approbation du fichier. Le client dépose son fichier, voit le rapport et les aperçus en quelques secondes, puis paie. Sinon, une commande payée peut contenir un fichier refusé : c'est ce que montre la commande FP-1002 de la démonstration, restée « payée » avec une ligne rejetée.
