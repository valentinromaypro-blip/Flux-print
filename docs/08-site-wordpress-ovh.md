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

## 9. Installer le plugin Carte Blanche (quand il est livré)
**Extensions → Ajouter → Téléverser une extension** → choisir `carte-blanche.zip` → **Activer**.
Si le fichier est trop lourd pour l'envoi par l'admin, le déposer par FTP dans `www/wp-content/plugins/`.
Le plugin affiche une page **Carte Blanche → Diagnostic** qui vérifie Imagick, Ghostscript et les limites PHP de l'hébergement.
