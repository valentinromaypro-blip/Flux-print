# Flux-print — Cadrage technique et fonctionnel

> Document de référence : tout ce qu'il faut concevoir, coder et mettre en place pour une plateforme web-to-print mono-produit / mono-niche, de la prise de commande jusqu'à la mise en machine.
> Produits pilotes envisagés : **jeu de cartes personnalisé** et **livre de coloriage personnalisé pour enfants**.

---

## 0. Remise en question des hypothèses de départ

Avant de lister les briques, cinq points de raisonnement qui changent l'architecture :

1. **Le vrai actif n'est pas le site, c'est le moteur.** Un site mono-produit est une coquille fine. Ce qui a de la valeur et se réutilise d'une niche à l'autre : le modèle de document, le moteur de rendu PDF, le pipeline de production, le back-office. → Architecture **« un moteur, N vitrines »** dès le départ, sinon vous réécrirez tout au deuxième site.

2. **Un preflight « comme dans le commerce » (PitStop, callas pdfToolbox) est conçu pour contrôler des PDF arbitraires fournis par des clients.** Vous, vous **générez** le PDF à partir de gabarits que vous maîtrisez. Donc 80 % du preflight se déplace en amont :
   - contrôle des **entrées** (photos : résolution, taille, visage détecté, contenu) ;
   - génération **déterministe et conforme par construction** (fonds perdus, profils ICC, polices incorporées) ;
   - contrôle de **sortie** automatisé (garde-fou, pas la ligne de défense principale).
   Le preflight classique reste utile, mais comme vérification finale, pas comme cœur du système.
   > **Amendé (D3, `01-decisions.md`)** : les clients pourront aussi déposer leur propre PDF sur gabarit. Le preflight de fichiers arbitraires devient donc une brique centrale, développée en interne.

3. **Aperçu écran = fichier imprimé.** Règle absolue : un seul moteur de rendu pour l'aperçu et le PDF de production. Si l'éditeur navigateur et le générateur PDF ont deux implémentations, ils divergeront (polices, césure, recadrage) et vous imprimerez des erreurs que le client n'a jamais vues. Le BAT (bon à tirer) montré au client doit être une rastérisation du PDF final.

4. **Mono-produit = imposition statique.** Les logiciels d'imposition commerciaux gèrent des milliers de cas. Vous en avez un ou deux par produit. L'imposition peut être codée en interne (quelques centaines de lignes) avec des gabarits fixes. Idem pour les job tickets.

5. **La question « qui imprime ? » conditionne tout le bas de chaîne** et n'est pas tranchée. Machine en propre, imprimeur partenaire unique, ou réseau de sous-traitants (modèle Gelato/Printful) : le format de sortie, l'intégration (JDF/JMF vs API vs hotfolder vs simple PDF + CSV), les délais et la marge en dépendent. **C'est la première décision à prendre.**

---

## 1. Vue d'ensemble de l'architecture

```
┌──────────────────────── FRONT OFFICE (N vitrines) ────────────────────────┐
│  Vitrine / SEO / Tunnel  →  Configurateur  →  Éditeur (builder)  →  Panier │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  │  Document JSON (modèle unique)
┌─────────────────────────────────▼──────────────────────────────────────────┐
│                               CORE / API                                   │
│  Catalogue & gabarits · Prix · Commandes · Clients · Paiement · Médias     │
└───────┬───────────────────────────┬───────────────────────────┬────────────┘
        │                           │                           │
┌───────▼────────┐        ┌─────────▼─────────┐        ┌────────▼──────────┐
│ Workers images │        │ Moteur de rendu   │        │ Orchestrateur de  │
│ (IA, détourage,│        │ PDF/X-4 + aperçus │        │ workflow (commande│
│ contrôles)     │        │ + preflight sortie│        │ → machine)        │
└────────────────┘        └───────────────────┘        └────────┬──────────┘
                                                                 │
                          ┌──────────────────────────────────────▼─────────┐
                          │ PRODUCTION : regroupement (ganging) · imposition│
                          │ · job ticket · envoi RIP/imprimeur · façonnage  │
                          │ · contrôle qualité · expédition                 │
                          └────────────────────────────────────────────────┘
```

---

## 2. Front office

### 2.1 Vitrine et tunnel de vente
- Multi-site / multi-domaine sur un seul code : thème, textes, catalogue, langue, devise par vitrine (config, pas de fork).
- Pages produit orientées conversion : exemples réels imprimés (photos, pas seulement des mockups), prix clair, délai de livraison calculé **avant** le panier (date garantie avant Noël = argument n°1 de ces niches).
- SEO : SSR/SSG (Next.js ou équivalent), données structurées Product, pages par occasion (anniversaire, mariage, fête des pères, EVJF, cadeau enfant…).
- Mockups 3D/2D générés automatiquement à partir du design du client (boîte de cartes, couverture de livre) : très fort levier de conversion.
- Compte client facultatif (commande invitée + sauvegarde du projet par lien magique e-mail).
- Sauvegarde automatique du projet en cours, reprise multi-appareils, relance panier abandonné avec aperçu du projet.
- Mobile first : la majorité des photos viennent du téléphone.

### 2.2 Configurateur produit
- Options pilotées par des **règles** déclaratives (format, papier, finition, quantité, emballage) avec incompatibilités (ex. : dorure impossible sur tel papier).
- Prix calculé côté serveur à partir d'une grille (coût matière + machine + façonnage + marge), jamais depuis le client.

### 2.3 Éditeur / builder
Décision **build vs buy** :
| Option | Pour | Contre |
|---|---|---|
| Solutions du marché (Customer's Canvas, Printess, Pitchprint…) | Rapide, PDF d'impression inclus | Licence récurrente, dépendance, UX générique, personnalisation IA limitée |
| Maison (Konva / Fabric.js / canvas + moteur de rendu serveur) | UX taillée pour la niche, pas de licence, contrôle total | Effort initial, gestion des polices/texte délicate |

**Recommandation** : maison, car mono-produit = éditeur **très contraint** (zones prédéfinies, pas de mise en page libre). Un éditeur contraint est bien plus simple qu'un éditeur libre et donne de meilleurs résultats imprimés.

Fonctions communes :
- Modèle de document **JSON versionné** (gabarit + calques + zones photo + zones texte + paramètres).
- Zones photo avec recadrage/zoom/rotation, indicateur de qualité (ppi effectif) en temps réel.
- Zones texte avec polices contrôlées (licences web **et** impression vérifiées), ajustement automatique, limites de caractères, filtrage des emojis/glyphes absents de la police.
- Affichage des repères : fond perdu, format fini, zone de sécurité.
- Annuler/rétablir, sauvegarde automatique.
- Aperçu final = rendu serveur du PDF (voir §4).

### 2.4 Spécifique jeu de cartes
- Choix du modèle de jeu (classique, vintage, moderne…), format (poker 63×88 mm, bridge 57×89 mm, tarot, mini…), nombre de cartes (32, 52+jokers, 54, 78).
- **Dos** : un seul design commun à toutes les cartes (photo, logo, motif), avec gabarit.
- **Faces** : jeu standard avec possibilité de remplacer les **figures** (Roi, Dame, Valet, éventuellement Jokers) par des visages.
- Pipeline visage : upload → détection de visage → détourage → alignement (yeux/échelle) → intégration dans le costume de la figure → stylisation optionnelle (gravure, aquarelle, pop art) pour cohérence graphique.
- **Point métier critique : les figures traditionnelles sont à deux têtes (symétrie centrale).** Le visage doit être placé deux fois, avec rotation à 180°, dans un gabarit prévu pour.
- Mode « chaque carte personnalisée » (photos de famille sur 52 cartes) = variante importante à prévoir dans le modèle de données (1 dos + N faces distinctes).
- Personnalisation de l'étui (tuck box) : développé à plat avec rabats, sens de lecture.
- Prévisualisation : éventail de cartes, étui 3D.

### 2.5 Spécifique livre de coloriage enfant
- Parcours : prénom, âge (tranche), genre grammatical (voir ci-dessous), apparence du héros, dédicace, choix de l'histoire.
- **Bibliothèque d'histoires par tranche d'âge** (ex. 2-4, 4-6, 6-8 ans) : longueur du texte, complexité du dessin (traits épais / zones larges pour les petits), nombre de pages.
- **Moteur de texte variable** : insertion du prénom, **accords en français** (il/elle, petit/petite, « le héros »/« l'héroïne », élisions « de Anna » → « d'Anna »). Prévoir aussi un mode neutre. Ce n'est pas un simple remplacement de chaîne : il faut un mini-langage de gabarit avec variantes grammaticales.
- **Personnalisation du héros : deux approches, à arbitrer.**
  - *Photo → trait de coloriage par IA* : impressionnant mais fragile (cohérence du visage d'une page à l'autre, qualité du trait, coût GPU, modération, données biométriques d'enfants).
  - *Avatar composé* (coiffure, couleur de peau inutile en coloriage mais forme du visage, lunettes, taches de rousseur, accessoires) assemblé à partir de calques vectoriels dessinés par un illustrateur : déterministe, 100 % cohérent, coût marginal nul, zéro photo d'enfant stockée. C'est le modèle éprouvé des livres personnalisés du marché.
  - **Recommandation** : MVP en avatar composé ; photo/IA en option premium sur la couverture uniquement, plus tard.
- Couverture en quadrichromie personnalisée, intérieurs en noir (trait).
- Aperçu page à page (feuilletage).

---

## 3. Traitement des images entrantes (préflight amont)

C'est ici que se joue la qualité d'impression.

- Upload direct vers stockage objet (URL présignées), reprise des uploads, limite de taille.
- Formats : JPEG, PNG, **HEIC/HEIF** (iPhone), WebP ; rejet propre du reste.
- Normalisation : orientation EXIF, suppression des métadonnées (GPS !), conversion sRGB avec profil incorporé respecté.
- Contrôles automatiques :
  - **résolution effective** à la taille de placement (seuil bloquant ~150 ppi, alerte < 250 ppi) ;
  - flou / surexposition / image trop sombre ;
  - visage détecté, un seul visage, visage de face, taille minimale ;
  - modération : nudité, violence, symboles haineux ; logos et personnages protégés (Disney, marques…) au moins signalés pour revue.
- Traitements : détourage (segmentation), recadrage intelligent, amélioration / upscaling raisonnable, stylisation.
- Antivirus sur fichiers uploadés.
- Chaque transformation produit un nouvel asset versionné (on ne détruit jamais l'original tant que la commande n'est pas expédiée).

---

## 4. Moteur de rendu et génération du PDF d'impression

### 4.1 Principes
- Entrée : document JSON + gabarit produit + assets. Sortie : **PDF/X-4** (ou PDF/X-1a si l'imprimeur l'exige).
- Rendu **déterministe** : même entrée → même PDF, octet près si possible (facilite le cache, les réimpressions et le débogage).
- Boîtes PDF correctes : MediaBox, **TrimBox**, **BleedBox** (fond perdu 2 à 3 mm selon imprimeur).
- Polices incorporées (sous-ensemble), texte vectoriel.
- **Gestion de la couleur** :
  - OutputIntent = profil de l'imprimeur (ex. FOGRA51/PSO Coated v3, FOGRA39, ou profil spécifique presse numérique) ;
  - photos : conserver RGB + ICC en PDF/X-4 et laisser le RIP convertir, **ou** convertir en CMJN côté serveur (LittleCMS) si l'imprimeur l'exige — à décider avec l'imprimeur ;
  - **noirs de texte et traits = 100 % K uniquement** (jamais de noir quadri pour du texte fin ou du trait de coloriage : le moindre défaut de repérage crée des halos colorés) ;
  - aplats noirs de grande surface = noir riche contrôlé (ex. C40 M30 Y30 K100) ;
  - **TAC (couverture d'encre totale)** plafonnée (≈ 300-320 % selon support).
- Les pages intérieures du livre de coloriage : **niveaux de gris / K seul**, trait vectoriel si possible (netteté parfaite, fichiers légers).

### 4.2 Choix techniques possibles
| Brique | Options |
|---|---|
| Génération PDF | PDFlib (commercial, référence PDF/X), ReportLab (Python), pdf-lib (JS, bas niveau), Typst (mise en page texte), moteur maison sur Cairo/Skia |
| Couleur | LittleCMS (via Pillow ImageCms, lcms2) |
| Rastérisation (aperçus, BAT) | MuPDF, pdfium, Ghostscript |
| Preflight de sortie | callas pdfToolbox CLI/Server (standard industriel, payant), Enfocus PitStop Server ; contrôles maison complémentaires |

**Recommandation** : moteur de rendu maison (Python : ReportLab ou Skia + lcms2) pour le contrôle total, validation par notre propre moteur de preflight (`services/print-engine`). Pas de licence callas, conformément à D5 (`01-decisions.md`).

### 4.3 Aperçus
- Aperçus basse définition générés à partir du **même** rendu (rastérisation du PDF), mis en cache par hash du document.
- Pour l'interactivité, l'éditeur peut afficher une approximation client, mais l'**aperçu de validation** avant paiement est le rendu serveur.

---

## 5. Preflight automatisé (contrôle de sortie)

Checklist exécutée sur chaque PDF généré, bloquante ou non :

| Contrôle | Seuil / règle |
|---|---|
| Format fini, TrimBox, BleedBox | Conformes au gabarit produit, fond perdu présent |
| Nombre de pages | Conforme (livre piqué : multiple de 4 ; jeu : nombre de cartes attendu) |
| Résolution des images | ≥ seuil par type d'élément |
| Espaces colorimétriques | Pas de RGB non géré, pas de tons directs non prévus |
| TAC | ≤ plafond support |
| Noir du texte / traits | K seul sous une certaine taille |
| Filets | ≥ 0,25 pt (sinon disparaissent) |
| Polices | Toutes incorporées |
| Zone de sécurité | Aucun texte ni visage hors zone |
| Surimpression | Pas de surimpression blanche, surimpression du noir cohérente |
| Transparences | Gérées (PDF/X-4) ou aplaties (PDF/X-1a) |
| Conformité PDF/X | Validation de norme |
| Cohérence commande | Le PDF correspond bien à la ligne de commande (ID, quantité, options) |

Résultats stockés et consultables dans le back-office ; toute anomalie non auto-corrigeable → file d'attente « revue humaine ».

---

## 6. Pipeline commande → machine (le cœur de l'automatisation)

### 6.1 Orchestration
Processus long (heures/jours), avec étapes humaines possibles, reprises sur erreur, idempotence : utiliser un **moteur de workflow durable** (Temporal recommandé ; alternative plus légère : files BullMQ/Celery + machine à états en base). Chaque commande = une instance de workflow traçable.

### 6.2 Étapes
1. **Paiement confirmé** (webhook) → création de l'ordre de fabrication.
2. **Gel du document** (snapshot immuable de la version validée).
3. **Génération du PDF** de production + aperçus.
4. **Preflight** (§5) → OK / auto-correction / revue humaine.
5. **BAT** : validation client explicite si l'offre le prévoit (sinon validation à la commande, déjà faite sur l'aperçu serveur).
6. **Délai d'annulation** éventuel (ex. 1 h) avant mise en production.
7. **Regroupement (ganging / batching)** : agréger les commandes compatibles (même papier, même format, même finition, même date d'expédition) pour remplir des feuilles/lots. Critères : date limite d'expédition, taux de remplissage, priorité (express).
8. **Imposition** : placement sur feuille machine (SRA3, 330×488, B2… selon presse) :
   - cartes : step-and-repeat avec traits de coupe/repères de découpe ; recto/verso en **retournement cohérent** ;
   - livre : imposition en cahiers (piqûre à cheval) ou page à page (dos carré collé) selon façonnage.
9. **Marques et traçabilité** : repères de coupe, repères de repérage, **code-barres / Datamatrix** par feuille et par pièce (ID commande + index) pour le suivi au façonnage et à l'emballage.
10. **Job ticket** : JDF/JMF si RIP compatible (HP Indigo, Fiery, Prinect…), sinon hotfolders + fiche de travail PDF/CSV ; fichiers de découpe pour table de découpe (Zünd, Kongsberg…) ou massicot programmable.
11. **Envoi** au RIP / DFE interne, ou à l'API / SFTP de l'imprimeur partenaire.
12. **Suivi de production** : retour d'état (JMF, scans de codes-barres aux postes : impression, coupe, façonnage, contrôle, emballage).
13. **Contrôle qualité** : scan final, photo éventuelle, comparaison au BAT.
14. **Expédition** : étiquette transporteur générée, numéro de suivi, e-mail client.
15. **Clôture** : facture, archivage, purge planifiée des données personnelles.

### 6.3 Contraintes de fabrication spécifiques

**Jeu de cartes** (le produit le plus exigeant en fabrication) :
- Support : carton spécial jeux (≈ 300-330 g) **à âme noire/bleue** (opacité : on ne doit pas voir la carte par transparence), vernis/pelliculage « air-cushion » pour la glisse.
- **Repérage recto/verso critique** : un décalage du dos rend les cartes **identifiables** (jeu « marqué »). Le dos doit avoir un motif tolérant (marge uniforme ou motif sans bord) et la presse doit tenir le repérage.
- Découpe + **coins arrondis**, **assemblage/collationnement** des 54 cartes dans le bon ordre (étape souvent manuelle, à concevoir), mise sous étui, cellophane.
- En pratique, peu d'imprimeurs maîtrisent ce produit en unitaire : **la disponibilité d'un partenaire équipé est une condition préalable**.

**Livre de coloriage** :
- Intérieur : papier **non couché** 120-160 g (les feutres ne doivent pas traverser) ; idéalement **impression recto seul** des dessins (le verso reste blanc) pour éviter le transfert des feutres → double le nombre de pages physiques, impact sur coût et façonnage.
- Façonnage : piqûre à cheval (multiple de 4 pages, simple et bon marché), dos carré collé (épaisseur de dos à calculer selon pagination et grammage — le gabarit de couverture est **dynamique**), ou spirale (le livre s'ouvre à plat, idéal pour colorier).
- Couverture quadri, pelliculage mat/brillant.
- Production numérique N&B intérieur + couleur couverture : très standard, nombreux imprimeurs POD disponibles.

---

## 7. Back-office

Objectif : zéro saisie manuelle dans le flux nominal, toute intervention humaine = exception tracée.

- **Tableau de bord production** : files par état (à générer, preflight KO, en attente BAT, prêt à imposer, en impression, façonnage, expédié), vieillissement, retards vs date promise.
- **Fiche commande** : historique complet (événements du workflow), aperçus, PDF, rapport de preflight, actions (régénérer, forcer, annuler, rembourser, **réimprimer** avec motif).
- **Gestion des gabarits et produits** : import de gabarits, versioning (une commande reste liée à la version du gabarit utilisée), mise en ligne/retrait, prévisualisation avec données de test.
- **Gestion des histoires** (livre) : textes par tranche d'âge, variantes grammaticales, illustrations, validation éditoriale.
- **Prix et promotions** : grilles, codes promo, prix par vitrine.
- **Service client** : recherche par e-mail / n° commande / code-barres, modification d'adresse avant expédition, renvoi, avoirs.
- **Modération** : file des contenus signalés par l'IA.
- **Routage imprimeur** (si plusieurs partenaires) : règles par produit/pays/capacité/coût.
- **Stocks** : papiers, étuis, emballages (seuils d'alerte).
- **Rôles et permissions** : admin, production, service client, éditorial ; journal d'audit.
- **Indicateurs** : taux de premier coup bon (first-time-right), taux d'échec preflight, délai commande→expédition, taux de réimpression par cause, coût unitaire réel, remplissage des feuilles.

---

## 8. Paiement, facturation, fiscalité

- PSP : Stripe (ou Mollie / Adyen) ; SCA/3-D Secure, Apple Pay/Google Pay, webhooks idempotents.
- TVA : B2C UE → guichet unique **OSS** si ventes à distance > 10 000 € dans l'UE ; taux par pays.
- Facturation : numérotation continue, conservation légale ; **réforme de la facturation électronique en France** (réception obligatoire pour toutes les entreprises à partir de septembre 2026, émission selon taille en 2026-2027, e-reporting pour le B2C) → choisir un outil de facturation/PDP compatible dès le départ.
- Gestion des remboursements partiels, avoirs, litiges (chargebacks).

---

## 9. Logistique et expédition

- Agrégateur transporteurs (Sendcloud, Boxtal…) ou API directes (Colissimo, Mondial Relay, Chronopost, DHL).
- Choix du transporteur par poids/destination/délai ; lettre suivie pour les produits plats légers (cartes).
- Calcul de la **date de livraison promise** = capacité de production + délais de fabrication + transport ; dates limites de commande pour Noël/fêtes affichées sur le site.
- Emballage adapté (protection des coins pour les livres), étiquettes et bordereaux générés automatiquement, tracking relayé au client.
- Gestion des retours / colis perdus.

---

## 10. Juridique et conformité (non négociable)

- **CGV** : les biens personnalisés sont **exclus du droit de rétractation** de 14 jours (art. L221-28 3° du Code de la consommation) — à écrire clairement. La garantie légale de conformité reste due (défaut d'impression).
- **Droits sur les images** : le client garantit détenir les droits sur les photos et le consentement des personnes représentées ; clause d'indemnisation ; retrait des contenus contrefaisants (marques, personnages sous licence, célébrités).
- **RGPD** :
  - photos de visages = données personnelles ; si traitement de reconnaissance/identification → données biométriques (régime renforcé) : limiter le traitement à la détection/segmentation, pas d'identification ;
  - **photos d'enfants** : consentement du parent, minimisation, **purge automatique** (ex. 30-90 jours après expédition), pas de réutilisation pour entraîner des modèles sans consentement explicite ;
  - sous-traitants (hébergeur, IA, imprimeur) : contrats art. 28, localisation des données (UE de préférence), registre des traitements, politique de confidentialité, gestion des cookies (CNIL).
- **AI Act** : obligations de transparence (art. 50, applicables depuis août 2026) pour les contenus générés/modifiés par IA — à évaluer pour la stylisation de visages (mention « image générée/modifiée par IA »).
- **Sécurité des produits (GPSR, règlement UE 2023/988)** : identification du fabricant/responsable, traçabilité, informations de sécurité ; pour un produit destiné aux enfants, vérifier si la norme jouets (EN 71) s'applique (en principe non pour un livre seul, **oui** si vous ajoutez des crayons ou un accessoire).
- Propriété intellectuelle de vos propres contenus : illustrations et histoires commandées à des illustrateurs/auteurs → **cession de droits écrite** ; polices : licences couvrant l'usage web **et** l'impression commerciale.
- Mentions légales, médiation de la consommation, accessibilité (RGAA / Directive européenne sur l'accessibilité applicable depuis juin 2025 pour l'e-commerce, hors micro-entreprises).

---

## 11. Infrastructure et exploitation

- **Stack recommandée** :
  - Monorepo TypeScript : front Next.js, API Node (NestJS ou Fastify), types partagés du modèle de document.
  - **Workers Python** pour l'image, l'IA et le rendu PDF (écosystème OpenCV, segmentation, lcms2, ReportLab/Skia).
  - PostgreSQL (données transactionnelles, JSONB pour les documents), Redis (cache, files).
  - Temporal pour l'orchestration commande → machine.
  - Stockage objet S3 compatible (originaux, dérivés, PDF) + CDN pour les aperçus.
  - GPU à la demande (serverless) pour l'IA, uniquement là où elle est indispensable.
- Hébergement UE, conteneurs (Docker), IaC (Terraform), environnements dev/staging/prod.
- CI/CD : lint, tests unitaires, **tests de non-régression visuelle des PDF** (rendu de gabarits de référence comparé pixel à pixel), tests E2E du tunnel.
- Observabilité : logs structurés, métriques, traces, alertes (preflight KO en rafale, file bloquée, webhook PSP en échec).
- Sauvegardes, plan de reprise, politiques de cycle de vie du stockage (les PDF pèsent lourd).
- Sécurité : authentification admin forte (2FA/SSO), secrets managés, principes OWASP, limitation de débit sur l'upload et l'IA (coût).
- **Montée en charge saisonnière** : pic de Noël = x5 à x10 ; workers de rendu élastiques, file d'attente tampon, capacité de production réservée à l'avance chez l'imprimeur.

---

## 12. Modèle de données (principales entités)

`Storefront` · `Product` · `ProductVariant` (format, papier, finition) · `Template` (versionné) · `TemplateSlot` (zones photo/texte) · `Story` / `StoryPage` / `StoryVariant` (livre) · `Asset` (original, dérivés, statut de modération) · `Project` (document JSON en cours) · `ProjectSnapshot` (version gelée) · `Order` / `OrderLine` · `Payment` · `ProductionJob` · `PreflightReport` · `Batch` (regroupement) · `ImpositionSheet` · `Shipment` · `Printer` (partenaire, capacités) · `AuditEvent`.

---

## 13. Économie unitaire (à modéliser avant de coder)

Pour chaque produit : coût papier + impression + façonnage + main-d'œuvre (assemblage des cartes !) + emballage + transport + frais de paiement + coût IA/rendu + taux de réimpression + acquisition client (CAC). Les niches de cadeaux personnalisés vivent de la publicité payante : si la marge brute ne couvre pas un CAC de 10-20 €, le modèle ne tient pas quel que soit le niveau d'automatisation.

---

## 14. Feuille de route proposée

| Phase | Contenu | Critère de sortie |
|---|---|---|
| **0. Décisions** | Qui imprime, premier produit, formats, papier, profil couleur, prix cible | Fiche technique signée avec l'imprimeur + BAT physique d'un prototype |
| **1. Moteur** | Modèle de document, moteur de rendu PDF/X-4, preflight maison, tests de non-régression visuelle | PDF validés par l'imprimeur sur 20 cas de test |
| **2. MVP produit 1** | Vitrine, éditeur contraint, upload + contrôles, panier, paiement, back-office minimal, envoi manuel des PDF | Premières commandes réelles livrées |
| **3. Automatisation production** | Workflow durable, regroupement, imposition, job tickets, codes-barres, étiquettes | Commande → fichier machine sans intervention |
| **4. Produit 2 / vitrine 2** | Réutilisation du moteur, nouveaux gabarits | Nouvelle vitrine en production en quelques semaines |
| **5. Optimisation** | IA avancée, A/B tests, routage multi-imprimeurs, callas en validation finale | Indicateurs §7 suivis et en amélioration |

### Quel produit en premier ?
- **Livre de coloriage** : fabrication simple et standard (POD N&B abondant), mais gros travail de contenu (histoires × âges × illustrations) et règles grammaticales.
- **Jeu de cartes** : contenu et éditeur plus simples (gabarit fixe), effet « waouh » immédiat, mais fabrication spécialisée (carton à âme, repérage, coins, collationnement).
- **Recommandation** : si un partenaire capable de fabriquer des jeux en unitaire est identifié, commencer par les **cartes** (time-to-market plus court côté logiciel) ; sinon commencer par le **livre**, dont la chaîne de fabrication est trouvable partout.

---

## 15. Questions ouvertes à trancher

1. **Production** : machine en propre (laquelle ? HP Indigo, Xerox, Canon, Konica ?), imprimeur partenaire unique, ou réseau ?
2. Premier produit et marché (France seule ? UE ?).
3. Volumes visés à 12 mois (conditionne build vs buy de l'éditeur et du preflight).
4. Budget licences (callas, éditeur du marché, PDFlib) vs budget développement.
5. Place de l'IA : cœur du produit (visage stylisé) ou option ?
6. Équipe : qui code, qui illustre, qui écrit les histoires, qui gère la production ?
7. Offre BAT : validation automatique à la commande ou BAT explicite ?
8. Positionnement prix (entrée de gamme vs premium) → choix papier/finition.
