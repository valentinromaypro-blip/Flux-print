# Production dans WordPress (plugin Carte Blanche)

Du jeu payé au PDF pour la presse, sans intervention. Menu **Carte Blanche → Production**.

## Le parcours d'un jeu
1. **Paiement confirmé** (commande « En cours ») : le jeu passe à *payé* et sa préparation démarre en tâche de fond.
2. **Préparation** : chaque carte devient un JPEG CMJN (PSO Coated v3 / FOGRA51) à 350 dpi, fond perdu compris :
   faces personnalisées du studio, faces standard du jeu classique (fournies avec le plugin), ou pages du PDF
   déposé (rendues par Ghostscript). Environ 0,5 s par carte sur le serveur ; découpé en tâches de 90 s.
3. **Amalgame** (toutes les 15 min) : les jeux prêts de même format et même carton partent en lot
   - aux créneaux de **11 h et 16 h** (heure de Paris) s'il y en a au moins **6** ;
   - **tout de suite** si un livre est plein (18 jeux en poker et bridge, 10 en tarot) ;
   - au plus tard **48 h** après le paiement.
   Le bouton **Lancer un lot maintenant** force le départ.
4. **PDF du lot** : imposition « pile = jeu ». La feuille *n* porte la carte *n* de chaque jeu ; après une coupe du livre
   au massicot, chaque pile est un jeu complet et trié, sa **carte d'identification** sur le dessus (n° de commande,
   client, exemplaire, à retirer avant la mise en étui). Recto verso **petit côté**, traits de coupe prolongés,
   n° de lot et de feuille dans la marge.
5. **Fiche de lot** (imprimable) : pour chaque livre, la commande de chaque pile. Puis **Marquer imprimé**.

## Modèles de recto

Le client choisit à l'étape « Les visages » un modèle (Classique ou Vintage) et un rendu des visages
(photo couleur, gravure bleue, noir et blanc, sépia). Les figures personnalisées sont dessinées dans
le navigateur ; les autres cartes sont les faces standard de l'atelier. En vintage (papier crème,
encres passées), l'atelier teinte ces faces avec le même calcul que le studio ; cache dans
`uploads/carte-blanche/fronts/{format}-vintage/`. Le modèle est enregistré dans la création
(`design.recto`) et affiché dans la commande (« Recto : Vintage »).

## Clients qui font leur jeu eux-mêmes (« J'ai mes fichiers »)

Parcours en 3 étapes (Vos fichiers, L'étui, Récap). Kit de création téléchargeable par jeu et par
format (REST `cb/v1/kit`, et page Guide via `[cb_kits]`) : gabarit PDF du jeu complet (une page par
carte, nommée, dans l'ordre), gabarit d'une carte en PNG (350 dpi) et SVG, gabarit d'étui, fiche
technique, mode d'emploi Canva. Fichiers mis en cache dans `uploads/carte-blanche/kits/`.

Dépôt d'un PDF ou d'une image par carte (rangées d'après leur nom : « dos », « as-pique »,
« 10-coeur », « H-A »…, sinon dans l'ordre ; vignettes échangeables). Corrections automatiques
plutôt que refus, signalées au client :

| Cas | Correction |
|---|---|
| Traits de coupe (export Canva, InDesign) | rendu de la zone de fond perdu du PDF (BleedBox) |
| Pas de fond perdu (format fini) | bords prolongés en miroir de 3 mm |
| Bonnes proportions, autre taille | mise à l'échelle (tolérance 0,5 % : un A4 est refusé) |
| Image sans fond perdu | bords prolongés en miroir (dans le navigateur) |

Le rapport montre le jeu entier en vignettes nommées avec la ligne de coupe, et un aperçu
« couleurs d'impression » (passage par PSO Coated v3).

## Conditionnement

Choisi par le client à l'étape « L'étui » du studio (ou dans le panneau d'envoi d'un PDF), avant la
validation, sur des maquettes de son propre jeu : sous film, dans l'étui à fenêtre qui laisse voir son dos,
ou dans son étui personnalisé (vue avant et arrière). À la validation, l'étui personnalisé est fabriqué au
gabarit exact et contrôlé. Le supplément s'ajoute au prix par jeu, après la remise quantité. Prix réglables
dans Carte Blanche → Production → Conditionnement, où se télécharge aussi le fichier d'impression de
l'étui à fenêtre de stock (poker 54 cartes : fond vert, marque crème, fenêtre ovale découpée).

| Option | Prix par défaut | À l'atelier |
|---|---|---|
| Sous film rétractable | inclus | — |
| Étui à fenêtre Carte Blanche (format poker) | +3 € | à sortir du stock (compté sur la fiche de lot, et indiqué sur la carte d'identification de chaque jeu) |
| Étui personnalisé | +6 € | bouton « PDF étuis perso » du lot, à transmettre à l'imprimeur du groupe |

Étui personnalisé : étui à rabats inversés calculé par le serveur pour le format et l'épaisseur du jeu
(nombre de cartes × épaisseur du carton : 0,40 mm en 350 g, 0,34 mm en 300 g, valeurs à confirmer ;
1,5 mm de jeu), patte de collage 12 mm, languettes 15 mm. Le client le crée dans le studio (face avant :
le dos du jeu, une photo, ou une couleur et un titre ; titre sur les tranches ; message au dos) ou dépose
un PDF fait sur le gabarit téléchargeable, contrôlé au format exact. Le PDF du lot contient une page par
jeu : étui à plat en CMJN avec 3 mm de fond perdu, découpe en ton direct `CutContour`, rainage en ton
direct `Rainage` (pointillés), tous deux en surimpression, et le repère de commande et d'exemplaires.

## Réglages Fiery
Échelle 100 %, sans rotation automatique ni imposition Fiery, recto verso **petit côté**, profil source CMJN
**FOGRA51 (PSO Coated v3)**, SRA3 320 × 450 mm.

## Tâches de fond sur OVH
Les tâches tournent avec les visites du site (WP-Cron). Sur un site peu visité, un lot peut attendre la visite suivante :
le bouton **Traiter maintenant** de la page Production fait tout de suite ce qui attend.

## Fichiers
Tout est dans `wp-content/uploads/sites/<n>/carte-blanche/` (protégé contre l'accès direct) :
`jobs/<création>/print/` (cartes CMJN), `fronts/<format>/` (faces standard converties une fois), `lots/<lot>.pdf`.
