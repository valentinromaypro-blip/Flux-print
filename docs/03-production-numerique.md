# Production numérique : Xerox Iridesse, SRA3 32 × 45 cm

Décision D7 : tous les produits sont imprimés en **numérique**, sur feuille **32 × 45 cm** (SRA3). Ce choix permet de gérer la donnée variable (chaque pose est différente) et de regrouper le plus de commandes possible sur un même tirage.

## 1. Chaîne mise en place

```
PDF client ─► prepare : preflight ─► boîtes PDF ─► conversion CMJN FOGRA51 ─► PDF de commande prêt
                                                                                   │
            plusieurs commandes compatibles (même support, format, recto/verso) ◄─┘
                                                                                   │
                          séquence de pièces + séparateurs ─► « coupe et empile »  │
                                                                                   ▼
             SRA3 32 × 45 préimposé, PDF/X-4, OutputIntent FOGRA51, traits de coupe,
             fond perdu 3 mm, repères, QR code de feuille  +  manifeste JSON
```

```bash
flux-print config                                               # presses, feuilles, produits
flux-print gabarit --product jeu-poker-54 gabarit.pdf
flux-print prepare --product jeu-poker-54 client.pdf -o cmd-001.pdf
flux-print impose  --product jeu-poker-54 cmd-001.pdf cmd-002.pdf:2 -o lot.pdf --manifest lot.json \
  [--sheet SRA3] [--marks edge|per_piece] [--order lanes|deck_stack|cut_stack|sequential] [--no-separators] [--rotation 0|90]
```

## 1 bis. Contenu du PDF de production (à envoyer au contrôleur de l'Iridesse)

| Élément | Valeur |
|---|---|
| Format | SRA3 320 × 450 mm, une page par face (recto, verso, recto…) |
| Norme | PDF/X-4 (PDF 1.6), transparences conservées |
| Couleur | CMJN. Profil de sortie **FOGRA51 / PSO Coated v3** incorporé (OutputIntent). Le RVB est converti en amont ; noirs et gris RVB en noir seul (K) |
| Encres spéciales | Tons directs nommés comme sur le contrôleur (`Gold`, `Silver`, `White`, `Clear`, `Fluorescent Pink` : **noms à confirmer**) conservés tels quels |
| Fond perdu | 3 mm sur toutes les pièces (règle imposée par la configuration) |
| Traits de coupe | 0,25 pt en couleur de repérage : prolongés à chaque ligne de coupe (`edge`), ou aux coins de chaque pièce (`per_piece`) |
| Repères | 4 carrés de repérage pour la découpe automatisée des coins, QR code et libellé de feuille (lot, n° de feuille, recto/verso, support, presse, profil) |
| Coins arrondis | Non tracés : opération de façonnage séparée |

**Pourquoi une conversion CMJN maison ?** Ghostscript 10 ne permet pas de choisir le profil CMJN de destination en sortie PDF. En plus, il transforme le texte noir RVB en noir quadri (72/67/67/88), illisible en petit corps. Notre convertisseur (LittleCMS, licence MIT) utilise le vrai profil FOGRA51 et respecte les profils incorporés aux photos. Il laisse intactes les encres spéciales et les boîtes PDF.

**Validation PDF/X :** aucun validateur PDF/X open source n'existe. La conformité est donc assurée à la construction. À faire une fois : passer un lot dans le preflight du contrôleur de l'Iridesse ou d'Acrobat pour confirmer.

## 2. Poses par feuille SRA3 (marge réservée de 10 mm par bord, fond perdu 3 mm, traits `edge`)

| Format | Poses | Disposition | 1 jeu de 54 | 1 jeu de 32 |
|---|---|---|---|---|
| Poker 63,5 × 88,9 | **18** | 3 × 6, cartes pivotées | **3 feuilles pleines** | 2 feuilles (4 poses libres) |
| Bridge 57,2 × 88,9 | 18 | 3 × 6, cartes pivotées | 3 feuilles pleines | 2 feuilles |
| Mini 44 × 63 | 36 | 6 × 6 | 1,5 feuille | 1 feuille (4 poses libres) |
| Tarot 61 × 112 | 12 | 4 × 3 | 4,5 feuilles | — |

| Carte de visite 85 × 55 | 21 | 3 × 7 | — | — |

Avec des traits de coupe par pièce (`per_piece`), l'écart de 4 mm entre les pièces coûte des poses : 16 au lieu de 18 pour une carte poker. En pose régulière, le style `edge` suffit : chaque coupe traverse toute la feuille et chaque pièce a ses traits sur les deux bords.

Un jeu de 54 cartes au format poker occupe exactement 3 feuilles. Sans séparateurs, 3 jeux remplissent 9 feuilles à 100 %. Avec séparateurs, il faut 165 pièces, soit 10 feuilles (remplissage de 91,7 %).

## 3. Ce qui a été développé

- **Grille de pose automatique** : le moteur teste les deux orientations et garde celle qui donne le plus de poses. L'orientation peut aussi être imposée (voir le sens des fibres au §4).
- **Regroupement contrôlé** : seules les commandes qui partagent la même clé sont regroupées. La clé combine le support, le format, le fond perdu et le mode recto/verso. Deux commandes incompatibles sont refusées explicitement.
- **Ordre « piles alignées » (option, façonnage plus complexe)** : le moteur choisit la hauteur du livre, c'est-à-dire le nombre de feuilles N coupées d'un seul coup. Chaque jeu occupe ⌈cartes / N⌉ piles consécutives, et **une pile n'appartient jamais qu'à un seul jeu** : ni séparateur ni tri. Pour un jeu sur plusieurs piles, on pose la première sur la suivante, dans l'ordre de la fiche de lot. N est choisi pour le coût le plus bas : feuilles imprimées × `sheet_cost_eur` + coupes × `cut_cost_eur` + piles à reposer × `merge_cost_eur`, dans la limite de `max_cut_sheets`.
  - Exemples, jeux de 54 : 18 jeux = 54 feuilles et 1 pile par jeu (la méthode « pile = jeu ») ; 9 jeux = 27 feuilles, 2 piles par jeu ; 2 jeux = 6 feuilles.
  - Des jeux de longueurs différentes (54, 32, oracle 22 à 100 cartes au même format) partagent le même livre.
  - Les lots partent aux **créneaux presse** (`launch_times`, par exemple 11:00 et 16:00, heure de Paris), avec tout ce qui a été payé avant. Ils partent aussi pour une urgence, pour un livre plein ou après le délai maximum.
- **Ordre « pile = jeu » (par défaut)** : un seul geste de façonnage, toujours le même. **Amalgame** : toutes les commandes du même format et du même carton partagent les planches, quelle que soit la longueur des jeux (54, 32, oracles au format poker), jusqu'à 18 jeux par livre. Les jeux sont rangés du plus long au plus court : un livre fait la hauteur de son jeu le plus long, et un jeu plus court laisse sa pose vide sur les dernières feuilles. Le livre fait 55 feuilles pour des jeux de 54 : la feuille 1 porte une **carte d'identification** par jeu (n° de commande en grand, « Jeu 1/2 », QR code). On imprime, on coupe le livre d'un seul coup, et chaque pile est un jeu complet avec son étiquette sur le dessus : on la retire et on met en étui. Les lots partent aux créneaux presse (11 h et 16 h) dès qu'il y a au moins `slot_min_decks` jeux. Sinon ils attendent le créneau suivant, jusqu'à 48 h au maximum, ou partent tout de suite pour une urgence ou un livre plein (18 jeux). Ancienne description : autant de feuilles que de cartes (54 pour un jeu de 54). La feuille *n* porte la carte *n* de chacun des jeux, un jeu par pose : 18 jeux par « livre » de 54 feuilles. On coupe le livre d'un seul coup au massicot, et **chaque pile est un jeu complet et trié**, prêt pour l'étui, sans aucun assemblage. La **fiche de lot** de l'atelier donne le plan des piles : quelle commande, quel exemplaire. Un livre n'accueille que des jeux de même longueur (54 et 32 ne se mélangent pas). Le lot attend 17 jeux sur 18 (seuil de 90 %), ou part après 24 h ou pour une urgence. En dessous de `deck_stack_min_decks` jeux (9 par défaut), il passe en coupe et empile compact, pour ne pas imprimer 54 feuilles pour 2 jeux.
- **Ordre « coupe et empile » compact** : la pose *k* de la feuille *s* reçoit la pièce *k·N + s*, où *N* est le nombre de feuilles du lot. Après la coupe, on pose la pile 1 sur la pile 2, et ainsi de suite. Les jeux ressortent déjà rangés et à la suite les uns des autres, **sans tri manuel**. Le mode séquentiel reste disponible.
- **Séparateurs** : une pièce imprimée précède chaque exemplaire de commande. Elle porte le numéro de commande, le numéro d'exemplaire et un QR code, pour séparer les jeux dans la pile.
- **Recto/verso** : la position au verso est calculée en miroir selon le mode de retournement de la presse (grand côté ou petit côté). La rotation du contenu est compensée pour que chaque dos corresponde exactement à sa face.
- **Données variables optimisées** : chaque page source n'est intégrée qu'une seule fois dans le PDF du lot. Un dos commun posé 54 fois ne pèse donc qu'une fois, et le serveur d'impression le garde en mémoire.
- **Fond perdu préservé** : pikepdf rogne par défaut les pages au format fini, ce qui supprimerait le fond perdu. La zone d'intégration est donc forcée pour inclure les 3 mm de fond perdu.
- **Repères** : traits de coupe à chaque ligne de coupe, 4 carrés de repérage pour une table de découpe numérique, identification de la feuille (numéro de lot, numéro de feuille, recto ou verso, support) et QR code.
- **Manifeste JSON** : liste de chaque pose (feuille, emplacement, commande, pièce), piles à assembler, taux de remplissage. Il sert à la traçabilité et au contrôle au façonnage.

## 4. Points à valider en atelier (ils conditionnent la qualité du produit)

1. **Sens des fibres.** Pour tenir 18 poses, les cartes sont pivotées : leur grand côté est parallèle au côté de 32 cm de la feuille. Pour que les fibres suivent la longueur de la carte (meilleure tenue et meilleur « claquant » du jeu), il faut un carton 32 × 45 **en fibres courtes**. En fibres longues, il faut forcer l'orientation avec `--rotation 0`, ce qui donne 16 poses (−11 % de rendement).
2. **Repérage recto/verso de la presse.** Il est typiquement de ±0,5 à 1 mm en numérique. Pour un jeu de cartes, c'est le point critique : un dos décalé rend les cartes reconnaissables. Il faut imprimer une feuille de test (croix au centre de chaque pose, au recto et au verso) sur la presse réelle, mesurer l'écart, puis prévoir une **correction du décalage recto/verso** dans la définition de la feuille. C'est une évolution simple à ajouter.
3. **Marge non imprimable** de l'Iridesse sur SRA3 : `reserved_margin_mm` (10 mm) dans `config/presses/xerox-iridesse.toml`, à mesurer.
3 bis. **Noms des encres spéciales** tels que le contrôleur les attend : à relever sur le DFE et à reporter dans `specialty_inks`.
3 ter. **Profil FOGRA51** : déposer `PSO_Coated_v3.icc` dans `config/icc/`. Sans lui, le PDF est produit sans OutputIntent et la commande l'annonce.
4. **Ordre de sortie des feuilles** (face dessus ou face dessous) : il détermine si la pile 1 commence par la feuille 1. On ajoutera un paramètre d'inversion quand on connaîtra la presse.
5. **Découpe et coins arrondis.**
   - Avec un outil de découpe par format, **un seul format par feuille** : c'est le cas actuel.
   - Avec une table de découpe numérique (Zünd, Kongsberg, Duplo…), on peut mélanger plusieurs formats sur une même feuille. Cela demandera un algorithme de placement non régulier, et la découpe se fera à partir des carrés de repérage déjà imprimés.

## 5. Limites du regroupement (à connaître)

On ne peut regrouper que des commandes qui partagent **le même support et le même mode d'impression**.
- Des cartes sur carton de 300 à 330 g ne peuvent pas partager une feuille avec des intérieurs de livre de coloriage sur papier de 120 à 160 g.
- Un étui de jeu (autre support, impression recto seul, découpe différente) forme son propre lot.

Le taux de regroupement réel dépend donc du **volume par support**, pas du nombre total de commandes.

## 6. Prochaines étapes

1. Correction du décalage recto/verso et inversion de l'ordre des piles (dès que la presse est connue).
2. Sortie **PDF/VT** : c'est le standard des données variables, que les serveurs d'impression numériques savent optimiser pour les très gros lots.
3. Fiche de travail pour la presse : support, recto/verso, nombre de feuilles, via JDF ou dossier surveillé selon le serveur d'impression.
4. Planificateur de lots : regrouper les commandes en attente par clé de regroupement et par date d'expédition promise, et déclencher un lot quand il est plein ou qu'une date limite approche.
5. Imposition de l'étui et du livre de coloriage : cahiers ou page à page sur 32 × 45.

## 7. Envoi au Fiery : uniquement des SRA3

```bash
flux-print dispatch lot.pdf --manifest lot.json [--check-only]
```

- **Contrôles bloquants avant dépôt :** chaque page fait exactement 320 × 450 mm (à 0,1 mm près), aucune page n'est pivotée, le fichier est en PDF/X-4 avec OutputIntent, et le nombre de faces correspond au manifeste (pair en recto/verso).
- **Routage :** chaque couple support / mode d'impression a son hot folder, configuré côté Fiery (support, recto/verso petit côté, CMJN source FOGRA51). Les chemins se déclarent dans `[[hot_folders]]` de `config/presses/xerox-iridesse.toml`.
- **Dépôt atomique :** copie dans `.flux-transit/` puis renommage. Le Fiery ne voit jamais de fichier partiel, et un même lot ne peut pas être déposé deux fois.
- **Manifeste :** il n'entre jamais dans un hot folder (le Fiery imprimerait tout ce qui y arrive). Il est archivé dans `manifestes/`.
