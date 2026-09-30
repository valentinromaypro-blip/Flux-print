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

Le client choisit un modèle à l'étape « Les visages », puis un rendu des visages (photo couleur,
gravure bleue, noir et blanc, sépia, pop / BD).

| Modèle | Ce qui est dessiné dans le navigateur | Ce que fournit l'atelier |
|---|---|---|
| Classique | les figures personnalisées | les autres cartes (faces standard) |
| Portrait | les figures personnalisées (photo pleine carte, sans symétrie) | les autres cartes, figures sans photo comprises (classiques) |
| Vintage | les figures personnalisées, teintées | les autres cartes, teintées à la préparation (même calcul que le studio) |
| Moderne | tout le jeu (`front-*` et `court-*`, environ 2 Mo) | rien |

Le modèle est enregistré dans la création (`design.recto`) et affiché dans la commande (« Recto »).
Les faces vintage de l'atelier sont mises en cache dans `uploads/carte-blanche/fronts/{format}-vintage/`.

## Réglages Fiery
Échelle 100 %, sans rotation automatique ni imposition Fiery, recto verso **petit côté**, profil source CMJN
**FOGRA51 (PSO Coated v3)**, SRA3 320 × 450 mm.

## Tâches de fond sur OVH
Les tâches tournent avec les visites du site (WP-Cron). Sur un site peu visité, un lot peut attendre la visite suivante :
le bouton **Traiter maintenant** de la page Production fait tout de suite ce qui attend.

## Fichiers
Tout est dans `wp-content/uploads/sites/<n>/carte-blanche/` (protégé contre l'accès direct) :
`jobs/<création>/print/` (cartes CMJN), `fronts/<format>/` (faces standard converties une fois), `lots/<lot>.pdf`.
