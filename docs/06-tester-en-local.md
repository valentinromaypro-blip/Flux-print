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
7. **Atelier** : http://localhost:3000/admin — identifiant au choix, mot de passe **atelier**.
   - « Lancer un lot maintenant » crée tout de suite les feuilles SRA3. Sans ce bouton, un lot part automatiquement quand les feuilles sont remplies à 90 %, ou après 24 h d'attente, ou pour une commande urgente.
   - Rechargez la page : téléchargez le **PDF SRA3** et son **manifeste**. Le jeu et l'oracle forment deux lots différents (formats différents), chacun avec son séparateur de commande.

## 4. Ce que la démonstration ne montre pas encore

- La **création en ligne sans fichier** (visage sur le Roi, prénoms) : annoncée « bientôt » sur le site.
- Les **vrais paiements** Stripe ou Revolut : ils nécessitent vos clés en mode test.
- Les **e-mails** de confirmation et la **livraison**.
- Le **dépôt automatique dans le Fiery** : à faire depuis l'atelier (`flux-print dispatch`).
