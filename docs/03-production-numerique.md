# Production numérique sur feuille 32 × 45 cm

Décision D7 : tous les produits sont imprimés en **numérique**, sur feuille **32 × 45 cm** (SRA3). Ce choix permet de gérer la donnée variable (chaque pose est différente) et de regrouper le plus de commandes possible sur un même tirage.

## 1. Chaîne mise en place

```
PDF client ──► preflight ──► PDF normalisé ─┐
PDF client ──► preflight ──► PDF normalisé ─┼─► regroupement (même gang_key)
PDF client ──► preflight ──► PDF normalisé ─┘          │
                                                        ▼
                             séquence de pièces (+ séparateurs de commande)
                                                        │
                                          répartition « coupe et empile »
                                                        │
                                                        ▼
                            PDF de lot 32 × 45 recto/verso + manifeste JSON
```

```bash
flux-print impose --format poker --deck 54 cmd-001.pdf cmd-002.pdf:2 cmd-003.pdf \
  -o lot.pdf --manifest lot.json [--order cut_stack|sequential] [--no-separators] \
  [--flip long_edge|short_edge] [--rotation 0|90]
```

## 2. Poses par feuille (marge réservée de 10 mm par bord, fond perdu 3 mm)

| Format | Poses | Disposition | 1 jeu de 54 | 1 jeu de 32 |
|---|---|---|---|---|
| Poker 63,5 × 88,9 | **18** | 3 × 6, cartes pivotées | **3 feuilles pleines** | 2 feuilles (4 poses libres) |
| Bridge 57,2 × 88,9 | 18 | 3 × 6, cartes pivotées | 3 feuilles pleines | 2 feuilles |
| Mini 44 × 63 | 36 | 6 × 6 | 1,5 feuille | 1 feuille (4 poses libres) |
| Tarot 61 × 112 | 12 | 4 × 3 | 4,5 feuilles | — |

Un jeu de 54 cartes au format poker occupe exactement 3 feuilles. Sans séparateurs, 3 jeux remplissent 9 feuilles à 100 %. Avec séparateurs, il faut 165 pièces, soit 10 feuilles (remplissage de 91,7 %).

## 3. Ce qui a été développé

- **Grille de pose automatique** : le moteur teste les deux orientations et garde celle qui donne le plus de poses. L'orientation peut aussi être imposée (voir le sens des fibres au §4).
- **Regroupement contrôlé** : seules les commandes qui partagent la même clé sont regroupées. La clé combine le support, le format, le fond perdu et le mode recto/verso. Deux commandes incompatibles sont refusées explicitement.
- **Ordre « coupe et empile »** : la pose *k* de la feuille *s* reçoit la pièce *k·N + s*, où *N* est le nombre de feuilles du lot. Après la coupe, on pose la pile 1 sur la pile 2, et ainsi de suite. Les jeux ressortent déjà rangés et à la suite les uns des autres, **sans tri manuel**. Le mode séquentiel reste disponible.
- **Séparateurs** : une pièce imprimée précède chaque exemplaire de commande. Elle porte le numéro de commande, le numéro d'exemplaire et un QR code, pour séparer les jeux dans la pile.
- **Recto/verso** : la position au verso est calculée en miroir selon le mode de retournement de la presse (grand côté ou petit côté). La rotation du contenu est compensée pour que chaque dos corresponde exactement à sa face.
- **Données variables optimisées** : chaque page source n'est intégrée qu'une seule fois dans le PDF du lot. Un dos commun posé 54 fois ne pèse donc qu'une fois, et le serveur d'impression le garde en mémoire.
- **Fond perdu préservé** : pikepdf rogne par défaut les pages au format fini, ce qui supprimerait le fond perdu. La zone d'intégration est donc forcée pour inclure les 3 mm de fond perdu.
- **Repères** : traits de coupe à chaque ligne de coupe, 4 carrés de repérage pour une table de découpe numérique, identification de la feuille (numéro de lot, numéro de feuille, recto ou verso, support) et QR code.
- **Manifeste JSON** : liste de chaque pose (feuille, emplacement, commande, pièce), piles à assembler, taux de remplissage. Il sert à la traçabilité et au contrôle au façonnage.

## 4. Points à valider en atelier (ils conditionnent la qualité du produit)

1. **Sens des fibres.** Pour tenir 18 poses, les cartes sont pivotées : leur grand côté est parallèle au côté de 32 cm de la feuille. Pour que les fibres suivent la longueur de la carte (meilleure tenue et meilleur « claquant » du jeu), il faut un carton 32 × 45 **en fibres courtes**. En fibres longues, il faut forcer l'orientation avec `--rotation 0`, ce qui donne 16 poses (−11 % de rendement).
2. **Repérage recto/verso de la presse.** Il est typiquement de ±0,5 à 1 mm en numérique. Pour un jeu de cartes, c'est le point critique : un dos décalé rend les cartes reconnaissables. Il faut imprimer une feuille de test (croix au centre de chaque pose, au recto et au verso) sur la presse réelle, mesurer l'écart, puis prévoir une **correction du décalage recto/verso** dans la définition de la feuille. C'est une évolution simple à ajouter.
3. **Marge non imprimable et pinces** : le paramètre `margin_mm` (10 mm) doit être ajusté selon la presse.
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
