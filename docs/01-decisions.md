# Décisions actées

| # | Date | Décision | Conséquence technique |
|---|---|---|---|
| D1 | 2026-09-29 | **Production interne** : l'entreprise est imprimeur et dispose de son parc machines. | Pas de routage multi-imprimeurs. Intégration directe avec les DFE/RIP de l'atelier (JDF/JMF ou hotfolders) et le façonnage. Les seuils de preflight se calent sur nos propres machines et supports. |
| D2 | 2026-09-29 | **Sites mono-produit**, premier produit : **jeu de cartes personnalisé**. | Spécification produit dans `docs/02-cartes-a-jouer.md` et `services/print-engine/flux_print/products/playing_cards.py`. |
| D3 | 2026-09-29 | **Deux parcours de commande** : configurateur en ligne **et** dépôt d'un PDF client réalisé sur notre gabarit. | Le preflight de fichiers arbitraires devient une brique centrale (et non plus un simple garde-fou). Gabarits téléchargeables générés automatiquement depuis la spécification produit. |
| D4 | 2026-09-29 | **Marché** : France, puis Europe. | Multilingue et TVA OSS à prévoir dans le modèle, pas à implémenter tout de suite. |
| D5 | 2026-09-29 | **Autonomie totale** : solution maison, pas de dépendance à un éditeur, coûts de lancement minimaux. | Pas de callas / PitStop / Customer's Canvas. Uniquement des bibliothèques open source sous licence permissive (voir ci-dessous). |
| D6 | 2026-09-29 | Volumes non déterminants à ce stade. | Architecture simple d'abord (monolithe modulaire + workers), mise à l'échelle ensuite. |
| D7 | 2026-09-29 | **Impression numérique sur feuille 32 × 45 cm** pour tous les produits, avec données variables et amalgame maximal. | Imposition maison en données variables, ordre « coupe et empile », séparateurs de commande, manifeste de traçabilité. Voir `docs/03-production-numerique.md`. |
| D8 | 2026-09-29 | **Moteur générique**, pensé pour tous les futurs produits et non pour le seul jeu de cartes. | Presses, feuilles et produits décrits dans des fichiers `config/*.toml`. Un nouveau produit à plat = une fiche, sans code. Un nouveau *type* (livre, calendrier) = un constructeur de `DocumentSpec`. |
| D9 | 2026-09-29 | Presses : **Xerox Iridesse**. | Profil `config/presses/xerox-iridesse.toml` : SRA3, retournement recto/verso, encres spéciales (or, argent, blanc, vernis, rose fluo) acceptées par le preflight. |
| D10 | 2026-09-29 | Sortie : **SRA3 32 × 45 préimposé**, PDF/X-4, **CMJN FOGRA51** (PSO Coated v3), **traits de coupe et fond perdu de 3 mm** pour tous les formats. | Conversion RVB → CMJN maison (LittleCMS), OutputIntent incorporé, fond perdu imposé à 3 mm par la configuration. |
| D11 | 2026-09-29 | **Coins arrondis** : opération de façonnage séparée (manuelle puis automatisée). | Aucun tracé de découpe dans le PDF de production ; le rayon reste indiqué sur les gabarits clients (zone de sécurité). |

## Politique de licences (conséquence de D5)

Être autonome ne signifie pas seulement « ne pas payer de licence » : il faut aussi éviter les licences qui imposeraient de publier notre code.

| Bibliothèque | Licence | Usage | Statut |
|---|---|---|---|
| pikepdf / qpdf | MPL-2.0 / Apache-2.0 | Lecture, analyse, correction de PDF | ✅ liée au code |
| pypdfium2 / PDFium | Apache-2.0 / BSD-3 | Positions du texte, rendus d'aperçu | ✅ liée au code |
| ReportLab | BSD | Génération des gabarits et des PDF | ✅ liée au code |
| Pillow, NumPy | MIT-CMU, BSD | Images | ✅ liée au code |
| LittleCMS | MIT | Conversions ICC | ✅ liée au code |
| **Ghostscript** | **AGPL-3.0** | Rendu CMJN (mesure d'encre uniquement) | ⚠️ **uniquement en processus externe, non modifié** |
| MuPDF / PyMuPDF | AGPL-3.0 | — | ❌ exclu (liaison directe = obligation de publier le code du service) |
| Poppler | GPL | — | ❌ exclu du code lié |

Si un jour l'usage de Ghostscript pose question (distribution, modification), Artifex vend une licence commerciale ; l'appel étant isolé dans `preflight/tac.py`, il reste remplaçable.

## Conséquence sur le cadrage

La section 0.2 du cadrage (« le preflight classique n'est qu'un garde-fou ») est **amendée** : avec le dépôt de fichiers clients, le preflight complet de PDF arbitraires fait partie du produit. Le rendu de nos propres documents reste conforme par construction et repasse par le **même** moteur de preflight.
