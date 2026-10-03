# Cahier des charges — modèles de figures pour Carte Blanche

Document à transmettre tel quel à la personne ou à l'IA qui dessine un nouveau modèle de figures
(rois, dames, valets) pour le studio Carte Blanche. Le client y remplace le visage de chaque figure
par sa propre photo, détourée automatiquement ; le jeu est ensuite imprimé en quadrichromie
(Xerox Iridesse, CMJN FOGRA51), recto verso, coupé au massicot, coins arrondis possibles.

## 1. Ce qu'on attend

Un **modèle** = un style cohérent de 12 figures (R, D, V × pique, cœur, carreau, trèfle).
Optionnel : les 40 autres cartes (as, 2 à 10, 2 jokers) dans le même style ; sinon le jeu utilise
les cartes standard.

Deux niveaux de livraison possibles. **Le niveau A est recommandé pour une IA générative.**

| | Niveau A : demi-figures (recommandé) | Niveau B : cartes complètes |
|---|---|---|
| Ce qu'on livre | la moitié haute de chaque figure, sans visage | la carte entière, deux têtes |
| Symétrie tête-bêche | faite par nous (rotation 180°), parfaite | à faire par le dessinateur, exacte |
| Index (R♥ dans les coins) | ajoutés par nous, identiques sur tout le jeu | dessinés par le dessinateur |
| Difficulté pour une IA | faible | élevée (symétrie, cohérence, texte) |

## 2. Formats et fichiers

Format de référence : **poker 63,5 × 88,9 mm** (fini), **+ 3 mm de fond perdu** de chaque côté.

| Élément | Niveau A (demi-figure) | Niveau B (carte complète) |
|---|---|---|
| Format avec fond perdu | 69,5 × 47,45 mm (moitié haute + 3 mm en haut et sur les côtés) | 69,5 × 94,9 mm |
| PNG (700 dpi) | 1916 × 1308 px | 1916 × 2616 px |
| SVG (préféré si vectoriel) | viewBox `0 0 69.5 47.45`, unités = mm | viewBox `0 0 69.5 94.9`, unités = mm |
| Couleurs | sRGB, profil sRGB IEC61966-2.1 incorporé | idem |

Le bord bas de la demi-figure (niveau A) correspond au **milieu de la carte** : le dessin doit s'y
arrêter proprement (ligne de séparation, bandeau ou fond uni), car il sera raccordé à sa copie
tournée de 180°.

Le format bridge (57,2 × 88,9 mm) est obtenu automatiquement en recadrant sur la largeur :
garder le fond **uni ou extensible** sur les 3 mm de chaque bord latéral au-delà de la zone utile.

## 3. Zones à respecter

Mesures depuis le **trait de coupe** (bord de la carte finie, sans fond perdu) :

- **Fond perdu (3 mm)** : le fond et les décors doivent déborder jusqu'au bord du fichier, rien d'important.
- **Zone de sécurité (4 mm à l'intérieur de la coupe)** : aucun texte, visage, couronne ou élément important au-delà.
- **Coins** : les coins peuvent être arrondis (rayon ≈ 3,5 mm) ; rien d'important dans un carré de 6 × 6 mm à chaque coin.
- **Index (niveau A)** : réserver un rectangle libre (fond uni ou très calme) de **10 × 22 mm** dans le coin haut gauche, à 3 mm de la coupe : nous y posons la lettre (R, D, V) et l'enseigne.

## 4. Le visage : la partie la plus importante

Le visage dessiné est **remplacé** par la photo du client. Il faut donc livrer chaque figure **sans
visage**, avec ce qui passe devant le visage sur un calque séparé.

Trois fichiers par figure (même format, mêmes dimensions, parfaitement superposables) :

| Fichier | Contenu |
|---|---|
| `…-fond.png` | tout le dessin **sans la tête** : fond, corps, vêtements, cou, et ce qui est **derrière** la tête (cheveux de dos, dossier, auréole). La zone du visage est vide ou d'un ton neutre. |
| `…-avant.png` | **transparent** sauf ce qui passe **devant** le visage : couronne, chapeau, bord de capuche, col, main, plume. Peut être vide. |
| `…-masque.png` | **noir** partout, **blanc** sur l'ovale où sera posé le visage (front au menton, oreille à oreille). |

Règles pour l'ovale du visage (blanc du masque) :

- visage **de face**, droit, centré horizontalement sur la figure ;
- largeur ≈ **26 à 32 % de la largeur de la carte finie** (16 à 20 mm), hauteur ≈ 1,15 × la largeur ;
- le **haut de l'ovale** se cale sous la couronne ou le chapeau (qui le recouvre de 2 à 4 mm) ;
- le **bas de l'ovale** arrive sur le col ou le cou, qui doit exister sur le calque `fond` ;
- même taille et même hauteur pour les 4 rois, les 4 dames et les 4 valets (cohérence du jeu).

Pour une IA : générer la figure **« sans visage, tête remplacée par un ovale uni gris clair »**, ou
générer avec visage puis effacer la tête ; la couronne ou le chapeau doivent rester entiers et
« flotter » au-dessus de l'ovale.

## 5. Style et impression

- Style **cohérent** sur les 12 figures : même trait, même palette, même cadrage.
- Rois, dames, valets reconnaissables sans lire l'index : couronne (roi), diadème ou voile (dame), toque ou chapeau à plume (valet).
- Couleur de l'enseigne présente dans chaque figure : rouge pour cœur et carreau, noir ou couleur sombre pour pique et trèfle.
- **Couleurs imprimables** : pas de vert, bleu ou orange fluo (hors gamut CMJN) ; pas de dégradé vers un noir pur RVB, utiliser un noir dense.
- Traits d'au moins **0,1 mm** ; textes éventuels d'au moins **6 pt**.
- Pas de texte généré par l'IA dans l'image (lettres déformées) : les noms et index sont ajoutés par nous.
- Pas d'effet « carte usée », de papier froissé ou d'ombre portée autour de la carte : la carte doit être plate, bord à bord.

## 6. Noms de fichiers

`{modele}/{couleur}-{rang}-{calque}.png`

- `{couleur}` : `S` pique, `H` cœur, `D` carreau, `C` trèfle
- `{rang}` : `K` roi, `Q` dame, `J` valet (puis `A`, `2` à `10` pour les autres cartes)
- `{calque}` : `fond`, `avant`, `masque` (figures) ; rien pour les autres cartes
- jokers : `JK-1.png`, `JK-2.png`

Exemple : `art-deco/H-K-fond.png`, `art-deco/H-K-avant.png`, `art-deco/H-K-masque.png`.

Plus une **fiche du modèle** (`{modele}/modele.txt`) : nom affiché (≤ 20 caractères), phrase de
présentation (≤ 90 caractères), rendu de visage conseillé (photo couleur, gravure bleue, noir et
blanc, sépia).

## 7. Droits

Création originale uniquement : pas de reprise de jeux existants (Grimaud, Bicycle…), de
personnages, de marques ou d'œuvres protégées. Si une IA est utilisée, ses conditions doivent
autoriser l'usage commercial des images produites.

## 8. Contrôle à la livraison

Nous vérifions, avant mise en ligne :

1. dimensions exactes et superposition des 3 calques ;
2. masque : un seul ovale blanc, net, de la bonne taille ;
3. raccord au milieu de la carte après rotation (niveau A) ;
4. rendu avec 3 visages tests (photo couleur et gravure) ;
5. épreuve imprimée sur l'Iridesse (couleurs, coupe, coins arrondis).

## Annexe : consigne type pour une IA d'images

> Illustration de figure de jeu de cartes, [roi / dame / valet] de [cœur / carreau / pique / trèfle],
> style [décrire : art déco, gravure, aquarelle…], palette [couleurs], vue de face, buste coupé au
> bord bas de l'image, **sans visage : la tête est un ovale uni gris clair**, [couronne / diadème /
> chapeau à plume] entier posé au-dessus de l'ovale, fond [uni / motif discret] qui remplit toute
> l'image jusqu'aux bords, coin haut gauche calme et sans détail, aucun texte, aucune lettre, aucun
> cadre, aucune ombre autour, image plate, format 1916 × 1308 px.

Garder la même consigne (seuls le rang, l'enseigne et les attributs changent) pour les 12 figures,
et la même graine ou la même image de référence de style si l'outil le permet.
