# Créer la boutique WordPress + WooCommerce sur OVH (Hébergement Pro)

Durée : environ 1 h, plus l'attente des e-mails d'OVH. Le plugin Carte Blanche s'installe à la fin (étape 9).

## 0. Le nom de domaine
- Espace client OVH → **Web Cloud** → **Noms de domaine**. Si tu n'en as pas, l'Hébergement Pro inclut souvent un domaine gratuit la première année : sinon, commande-le (ex. `carteblanche-jeux.fr`).
- Le domaine doit être rattaché à l'hébergement : **Hébergements** → ton hébergement → onglet **Multisite** → le domaine et `www.` pointent vers le dossier `www`.

## 1. Régler PHP
**Hébergements** → ton hébergement → onglet **Informations générales** → **Configuration globale** → **Modifier la configuration** :
- Version PHP : **8.2** (ou 8.3)
- Moteur : **php** (PHP-FPM activé : 512 Mo de mémoire, 165 s par requête)
- Environnement : **production**
- Environnement d'exécution : **stable64** (nécessaire pour Imagick)

## 2. Installer WordPress
Onglet **Modules en 1 clic** → **Ajouter un module** → **WordPress** :
- cocher **Installation en mode avancé**
- langue **Français**, dossier d'installation **www** (il doit être vide)
- identifiant administrateur (évite « admin ») et **mot de passe fort** (gestionnaire de mots de passe)
- valider : un e-mail arrive quand c'est prêt (de quelques minutes à 1 h)

## 3. Activer le HTTPS
Onglet **Multisite** → pour le domaine et `www.`, **Modifier** → cocher **SSL**. Puis onglet **Informations générales** → **Certificat SSL** → **Commander / Régénérer** (Let's Encrypt, gratuit). Attendre l'activation (jusqu'à quelques heures).
Ensuite dans WordPress : **Réglages → Général** → les deux adresses en `https://`.

## 4. Premiers réglages WordPress (`https://ton-domaine.fr/wp-admin`)
- **Réglages → Général** : titre du site, fuseau horaire **Paris**
- **Réglages → Permaliens** : **Titre de la publication**
- **Extensions** : supprimer celles qui ne servent pas (Hello Dolly…)

## 5. Installer WooCommerce
**Extensions → Ajouter** → rechercher **WooCommerce** → **Installer** → **Activer**. Dans l'assistant :
- pays **France**, devise **Euro**, produits **physiques**
- refuser les extensions proposées dont tu n'as pas besoin
- **WooCommerce → Réglages → Général** : adresse de l'atelier, vente en France (puis UE)
- **Taxes** : activer, prix saisis **TTC**, taux standard France 20 %

## 6. Le thème
**Apparence → Thèmes → Ajouter** : **Kadence** (gratuit, rapide, compatible WooCommerce, édition en blocs). Le thème Carte Blanche (couleurs, polices, page d'accueil) viendra ensuite par-dessus.

## 7. Paiement et livraison
- **Paiement** : extension **WooCommerce Stripe Payment Gateway** (officielle). Créer un compte Stripe, coller les clés **de test** d'abord, faire une commande d'essai, puis passer en clés **réelles**.
- **Livraison** : **WooCommerce → Réglages → Expédition** → zone **France** → tarif forfaitaire pour commencer. Ensuite, extension **Colissimo** officielle (étiquettes et suivi) et/ou **Mondial Relay** (points relais).
- **Facturation** : connecteur **Sellsy** (ou Pennylane) pour WooCommerce, à vérifier dans leurs catalogues d'applications ; sinon une extension de factures PDF.

## 8. Obligations légales
- Pages **Mentions légales**, **CGV** (avec l'exception au droit de rétractation pour les produits personnalisés, art. L221-28 3° du Code de la consommation), **Politique de confidentialité** (conservation des photos de visages : 3 mois après expédition, par exemple).
- **WooCommerce → Réglages → Avancé** : associer les pages CGV / confidentialité.
- Bandeau cookies : **Complianz** (gratuit) si tu ajoutes des statistiques ou du marketing.
- Sauvegardes : OVH en fait ; ajouter **UpdraftPlus** vers un stockage externe.

## 9. Installer le plugin Carte Blanche
Le fichier : `dist/carte-blanche.zip` (fabriqué par `wordpress/build.sh`, environ 20 Mo).

**Réseau multisite (cas de goodies-sport.fr)** : les extensions s'installent pour tout le réseau, puis s'activent site par site.
1. **Mes sites → Admin du réseau → Extensions → Ajouter → Téléverser une extension** → `carte-blanche.zip` → **Installer**. Ne pas cliquer « Activer sur le réseau ».
2. Aller sur le tableau de bord du site **carteblanche.goodies-sport.fr** → **Extensions** → activer **WooCommerce** (s'il ne l'est pas déjà) puis **Carte Blanche**.
3. Si l'envoi échoue (fichier trop lourd), décompresser le zip et déposer le dossier `carte-blanche` par FTP dans `www/wp-content/plugins/`, puis reprendre à l'étape 2.

**Vérifier** : menu **Carte Blanche → Diagnostic** (PHP, Imagick, Ghostscript, mémoire, durée d'exécution).

**Mettre en place le site** : menu **Carte Blanche → Mise en place** → **Installer la structure du site**. En un clic :
- 13 pages rédigées pour le référencement, en blocs natifs : accueil, comment ça marche, atelier, entreprises, famille, mariage, FAQ, guide PDF, livraison, contact, mentions légales, CGV, confidentialité ;
- les deux jeux (54 cartes, belote) avec le studio branché, les illustrations, le menu principal et le pied de page ;
- page d'accueil, permaliens, euro, TVA 20 %, prix TTC, CGV liées au paiement.

Rien n'est écrasé : relançable sans doublon. La page liste ensuite les champs **[à compléter]** (surlignés en jaune dans les pages) : SIRET, délais, contact…

Thème conseillé : **Kadence** (menus classiques, rapide). Avec un thème en blocs (Twenty Twenty-Five), le pied de page du thème est à modifier dans Apparence → Éditeur.

