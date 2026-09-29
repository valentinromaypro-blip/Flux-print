# Facturation automatique avec Sellsy

Chaque commande **payée par carte** (Stripe ou Revolut) reçoit sa facture dans **Sellsy**, créée par le
moteur via l'API Sellsy v2. Sellsy la numérote (suite légale unique de l'imprimerie) et la transmet à
Pennylane comme vos autres factures. Stripe n'émet que des reçus : pas de double facturation.

## Ce que fait le moteur, pour chaque commande payée
1. Retrouve le client dans Sellsy (même e-mail = même contact), sinon le crée (particulier).
2. Crée la facture : une ligne par jeu (« 2 × Le jeu classique »), montant HT calculé depuis le prix TTC
   payé, TVA 20 %, référence = numéro de commande (FP-…), plus une ligne « Livraison » si le total payé
   comprend des frais de port.
3. **Valide** la facture (numéro définitif) et enregistre numéro et lien PDF sur la commande.
4. En cas d'échec (Sellsy indisponible, réglage manquant) : la commande continue sa production,
   l'erreur s'affiche sur sa fiche dans l'atelier et un nouvel essai a lieu automatiquement ;
   au-delà de 30 minutes, elle apparaît dans « À faire ».

Les paiements de **test** ne sont jamais facturés (sauf réglage d'essai ci-dessous).

## Mise en route (une fois)
1. Dans Sellsy : *Paramètres → Portail développeur (API)* → créer un accès API **personnel**
   (identifiants « client_id » / « client_secret »). Vérifiez que votre abonnement inclut l'API.
2. Vérifiez qu'un taux de **TVA 20 %** est actif dans Sellsy (*Paramètres → Taxes*).
3. À la racine du projet, créez un fichier `.env` (il n'est jamais envoyé sur GitHub) :
   ```
   FLUX_INVOICING=sellsy
   SELLSY_CLIENT_ID=...
   SELLSY_CLIENT_SECRET=...
   ```
4. Relancez : `docker compose up -d`.

## Premier essai (important)
Une facture **validée** est un document comptable définitif. Pour le tout premier essai :
- idéalement sur un compte Sellsy de test ; sinon, faites une vraie commande de faible montant
  et annulez-la ensuite par un avoir dans Sellsy ;
- pour facturer une commande payée avec le paiement de test du site, ajoutez temporairement
  `FLUX_INVOICE_TEST_PAYMENTS=true` au `.env`, puis retirez-le.

Vérifiez dans Sellsy : client, lignes, TVA, total TTC identique au montant payé, référence FP-….
Le format exact de l'API Sellsy n'a pas pu être vérifié contre la documentation officielle au moment
du développement : si Sellsy refuse une requête, le message d'erreur complet s'affiche sur la fiche
commande. Envoyez-le et l'adaptation se fait dans un seul fichier
(`services/print-engine/flux_print/orders/invoicing.py`).
