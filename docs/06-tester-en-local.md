# Tester tout le parcours sur votre ordinateur

La démonstration tourne entièrement chez vous : le site, la base de données et le moteur d'impression. Rien n'est envoyé sur internet, et le paiement est simulé.

## 1. Installation (une seule fois)

1. Installez **Docker Desktop** (Windows ou Mac) : https://www.docker.com/products/docker-desktop/ — lancez-le et attendez qu'il indique « Engine running ».
2. Récupérez le projet : sur GitHub, dépôt `Flux-print`, branche `claude/web-to-print-platform-f4ya5p`, bouton **Code → Download ZIP**, puis décompressez le dossier.
3. Ouvrez un terminal **dans ce dossier** :
   - Windows : clic droit dans le dossier → « Ouvrir dans le terminal » ;
   - Mac : Terminal, puis tapez `cd ` et glissez le dossier dans la fenêtre.
4. Lancez :

```bash
docker compose up --build
```

La première fois, comptez 5 à 10 minutes : Docker télécharge et construit tout. Quand la ligne `7 produits publiés, gabarits générés.` apparaît, c'est prêt.

5. Ouvrez **http://localhost:3000**.

Pour arrêter : `Ctrl + C` dans le terminal. Pour tout remettre à zéro (commandes et fichiers effacés) : `docker compose down -v`.

## 2. Fichiers de test fournis

Dans le dossier `apps/site/public/exemples/` (ou directement sur http://localhost:3000/exemples/…) :

| Fichier | Produit | Résultat attendu |
|---|---|---|
| `jeu-54-carte-blanche.pdf` | Le jeu classique | Accepté : un vrai jeu de 54 cartes avec figures personnalisées (Papa, Maman, Léo…) |
| `oracle-30-tarot.pdf` | Jeu oracle, **30 cartes**, format tarot | Accepté |
| `jeu-54-a-corriger.pdf` | Le jeu classique | Refusé : fond perdu manquant, image pixelisée, police non incorporée, texte trop près du bord (Dame de pique) |

Vous pouvez bien sûr tester avec vos propres fichiers : téléchargez le gabarit depuis la page du produit.

## 3. Parcours à tester

1. **Accueil** : produits et prix « à partir de » (prix fictifs).
2. **Le jeu classique** : changez le carton et la quantité, le prix se met à jour (dégressif dès 5 exemplaires). Téléchargez le gabarit. Déposez `jeu-54-carte-blanche.pdf`. Après quelques secondes : « Votre fichier est prêt à imprimer » et les aperçus.
3. **Jeu oracle** : réglez 30 cartes et 2 exemplaires, déposez `oracle-30-tarot.pdf`.
4. **Fichier fautif** : sur le jeu classique, déposez `jeu-54-a-corriger.pdf`. Lisez les messages, puis « Déposer un fichier corrigé ».
5. **Panier** : adresse, puis **Payer**. Sur la page de paiement de test, « Simuler un paiement accepté ».
6. **Suivi de commande** : l'étape « Fichiers préparés pour l'impression » passe au vert quand le lot est créé.
7. **Atelier** : http://localhost:3000/admin — identifiant au choix, mot de passe **atelier**. Le tableau de bord de pilotage : chiffre d'affaires, flux de production étape par étape, liste « À faire » (lots à imprimer, commandes à expédier, erreurs à relancer, clients à relancer), charge de la presse par carton, commandes et lots SRA3. Chaque commande a sa **fiche** (clic sur son numéro) : adresse de livraison, fichier client, PDF d'impression CMJN, lot SRA3 avec les feuilles où se trouve le jeu, historique, bon de livraison à imprimer, et expédition (transporteur, n° de suivi).

   Pour le voir rempli avant d'avoir de vraies commandes, chargez 30 jours d'activité fictive :
   ```bash
   docker compose exec db psql -U postgres -d flux -f /flux/supabase/seed/demo.sql
   ```
   - « Lancer un lot maintenant » crée tout de suite les feuilles SRA3. Sans ce bouton, un lot part automatiquement quand les feuilles sont remplies à 90 %, ou après 24 h d'attente, ou pour une commande urgente.
   - Rechargez la page : téléchargez le **PDF SRA3** et son **manifeste**. Le jeu et l'oracle forment deux lots différents (formats différents), chacun avec son séparateur de commande.

## 4. Création en ligne (sans fichier)

Sur « Le jeu classique » ou « Le jeu de belote », mode **Créer en ligne** : un studio en 3 étapes, avec un grand aperçu dessiné comme le moteur l'imprimera.
1. **Le dos** : 8 modèles (Classique, Art déco, Rayures, Monogramme, Photo, Logo entreprise, Logo en motif, Élégant), dont les vignettes montrent en direct le texte et le logo du client. Couleurs prédéfinies ou couleurs de marque au choix, logo (PNG transparent conseillé, avec option « une seule couleur »), photo à placer à la souris pour le modèle Photo. Les modèles sont des SVG (`services/print-engine/flux_print/design/backs/`), communs à l'aperçu et à l'impression : on peut en dessiner d'autres dans Illustrator en gardant les champs {{…}}.
2. **Les visages** : ajoutez une ou plusieurs photos (une personne par photo). La tête est **détourée automatiquement dans le navigateur** puis se glisse sur les figures (ou « Remplir les figures vides »). Dans le grand aperçu, on déplace le visage à la souris ou au doigt, et on règle sa taille (molette, − / +). Rendu couleur ou gravure bleue. Les figures sans photo gardent leur visage d'origine.
3. **Finitions** : carton, quantité, prix, puis **Valider mon jeu** : le moteur fabrique les 55 cartes en qualité d'impression (environ 15 s), les contrôle et affiche le vrai rendu avant l'ajout au panier.

Le détourage utilise le modèle MediaPipe « selfie multiclass » (Apache-2.0, 16 Mo) et son moteur WASM (12 Mo), servis par le site : ils sont récupérés au build (`tools/fetch-segmenter.mjs`, accès à storage.googleapis.com nécessaire une fois). S'ils manquent, l'éditeur découpe la photo en ovale.

Après une mise à jour du projet, relancez avec `docker compose down -v` puis `docker compose up --build` : la base est recréée avec les nouvelles tables.

## 5. Ce que la démonstration ne montre pas encore

- Les **vrais paiements** Stripe ou Revolut : ils nécessitent vos clés en mode test.
- Les **e-mails** de confirmation et la **livraison**.
- Le **dépôt automatique dans le Fiery** : à faire depuis l'atelier (`flux-print dispatch`).
