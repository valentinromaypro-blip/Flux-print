<?php
/**
 * Pages créées par la mise en place : contenu rédigé pour le référencement (une page = une
 * intention de recherche), en blocs natifs. Les passages [à compléter] sont à remplir par l'atelier.
 *
 * @var callable(string):string $u   adresse d'une page (clé)
 * @var callable(string):string $pr  adresse d'un produit (clé)
 * @var callable(string):?int   $img identifiant d'une image de la médiathèque (clé)
 */

defined('ABSPATH') || exit;

use CB_Blocks as B;

$cta = fn(string $title = 'Prêt à créer votre jeu ?') => B::section([
    B::h($title, 2, true),
    B::p('Choisissez un dos, ajoutez vos photos : vous voyez chaque carte telle qu’elle sera imprimée avant de commander.', true),
    B::buttons([['Créer mon jeu de 54 cartes', $pr('jeu-54')], ['Créer mon jeu de belote', $pr('belote'), true]], true),
], '#F3EFE7');

$steps = B::columns([
    [B::h('1. Choisissez votre dos', 3), B::p('Huit modèles à personnaliser : couleurs, prénom, date, logo ou photo en fond. Le dos est identique sur toutes les cartes.')],
    [B::h('2. Ajoutez vos visages', 3), B::p('Importez une photo par personne : la tête est détourée automatiquement, puis glissée sur les rois, les dames et les valets.')],
    [B::h('3. Validez et recevez', 3), B::p('Nous contrôlons votre jeu, vous voyez le rendu final, puis nous l’imprimons dans notre atelier et vous l’expédions.')],
]);

$faq_common = [
    ['Combien de temps faut-il pour créer son jeu ?', 'Une dizaine de minutes : le détourage des visages est automatique, il suffit de glisser chaque photo sur une figure.'],
    ['Quelles photos utiliser ?', 'Une photo nette, de face, bien éclairée, avec une seule personne. Les photos de smartphone conviennent parfaitement.'],
    ['Mes photos sont-elles envoyées sur vos serveurs ?', 'Non. Le détourage se fait directement dans votre navigateur : seules les cartes finales, à la taille d’impression, nous sont transmises pour fabriquer votre jeu.'],
    ['Puis-je utiliser mon propre fichier ?', 'Oui : si vous avez créé votre jeu vous-même, déposez votre PDF sur la fiche produit. Nous vérifions automatiquement le nombre de pages, le format et le fond perdu. <a href="' . $u('guide-pdf') . '">Voir le guide du fichier PDF</a>.'],
    ['Quels sont les délais de livraison ?', B::todo('délai de fabrication et de livraison') . ' <a href="' . $u('livraison') . '">Tout sur la livraison</a>.'],
];
$faq = fn(array $items) => B::join(array_map(fn($q) => B::details($q[0], $q[1]), $items));

return [
    // --- Accueil ---------------------------------------------------------------------------
    'accueil' => [
        'title' => 'Jeu de cartes personnalisé avec vos photos',
        'slug' => 'accueil',
        'focus' => 'jeu de cartes personnalisé',
        'seo_title' => 'Jeu de cartes personnalisé avec vos photos, imprimé en France | %site%',
        'seo_desc' => 'Créez votre jeu de cartes personnalisé en ligne : vos visages sur les rois, dames et valets, un dos à votre image. Jeu de 54 cartes, belote, bridge, oracle, imprimés dans notre atelier.',
        'content' => B::join([
            // Accroche
            B::columns([
                [
                    B::h('Votre jeu de cartes personnalisé. <em>Vos règles.</em>', 1),
                    B::p('Jeux de cartes, jeux de famille et oracles à votre image : vos visages sur les figures, votre dos, votre fichier. Vous voyez tout avant de payer.', false, false, 'cb-sub'),
                    B::buttons([['Créer mon jeu →', $pr('jeu-54'), 'red'], ['Voir comment ça marche', $u('comment-ca-marche'), true]]),
                    B::ul(['Contrôle du fichier en direct', 'Carton 350 g', 'Fabriqué en France'], 'cb-promise'),
                ],
                [B::image($img('scene-hero'), 'Éventail de cartes Carte Blanche sur un tapis vert, avec leur étui')],
            ], true, true, 'cb-hero', ['42%', '58%']),

            // Les jeux
            B::group([
                B::h('Choisissez votre jeu'),
                B::p('Tout se personnalise ensuite : carton, dos, figures, nombre de cartes.'),
            ], 'cb-head', null, null, '', 'flow'),
            '<!-- wp:html --><span id="jeux"></span><!-- /wp:html -->',
            B::group([B::shortcode('[products limit="6" columns="3" category="jeux-de-cartes-personnalises" orderby="menu_order" order="ASC"]')], 'cb-products', null, null, '', 'flow'),

            // Oracle
            B::group([
                B::columns([
                    [B::image($img('scene-oracle'), 'Cartes oracle au format tarot : la Lune, le Soleil, l’Étoile')],
                    [B::group([
                        B::h('Votre oracle, de 22 à 100 cartes'),
                        B::p('Format tarot ou poker, chaque carte unique, coins arrondis. Envoyez votre fichier : le nombre de cartes est détecté et le prix s’ajuste.', false, false, 'cb-muted'),
                        B::buttons([['Créer mon oracle', $pr('oracle')]]),
                    ], 'cb-text', null, null, '', 'flow', '')],
                ], true, false, '', ['58%', '42%']),
            ], 'cb-feature', 'stone', null, '', 'flow'),

            // Occasions
            '<!-- wp:html --><span id="occasions"></span><!-- /wp:html -->',
            B::h('Pour chaque occasion', 2, false, true),
            B::columns([
                [B::image($img('occ-mariage'), 'Dos de carte personnalisé pour un mariage', $u('mariage'), 'Mariage')],
                [B::image($img('occ-anniversaire'), 'Dos de carte personnalisé pour un anniversaire', $u('famille'), 'Anniversaire')],
                [B::image($img('occ-evjf'), 'Dos de carte personnalisé pour un EVJF', $pr('jeu-54'), 'EVJF')],
                [B::image($img('occ-entreprise'), 'Dos de carte personnalisé pour une entreprise', $u('entreprise'), 'Entreprise')],
            ], false, true, 'cb-occasions'),

            // Étapes
            B::h('Trois étapes, et vous voyez tout avant de payer', 2, false, true),
            B::columns([
                [B::image($img('scene-etui'), ''), B::h('1. Choisissez', 3), B::p('Le jeu, le carton et le dos : couleurs, prénom, date, logo ou photo en fond.')],
                [B::image($img('scene-detail'), ''), B::h('2. Personnalisez', 3), B::p('Vos visages détourés automatiquement sur les figures, ou votre propre PDF, contrôlé en quelques secondes.')],
                [B::image($img('scene-famille'), ''), B::h('3. Vérifiez et commandez', 3), B::p('Vous voyez vos cartes imprimées avant de payer. Nous les fabriquons dans notre atelier.')],
            ], false, true, 'cb-steps'),

            // Contenu pour le référencement
            B::h('Vos visages sur les figures', 2, false, true),
            B::columns([
                [B::image($img('figures'), 'Roi, dame et valet de cœur d’un jeu de cartes classique')],
                [
                    B::p('Les douze figures d’un jeu classique (roi, dame et valet de pique, cœur, carreau et trèfle) peuvent recevoir chacune un visage différent. La tête est détourée automatiquement et placée <strong>en haut et en bas</strong> de la carte, comme sur un vrai jeu.'),
                    B::p('Vous ajustez la taille et la position de chaque visage, puis vous choisissez le rendu : <strong>photo couleur</strong> ou <strong>gravure bleue</strong>, dans l’esprit des jeux anciens. Vos photos restent sur votre ordinateur : seules les cartes finales nous sont envoyées.'),
                ],
            ], true),
            B::h('Un dos de cartes à votre image', 2, false, true),
            B::columns([
                [
                    B::p('Classique, art déco, rayures, monogramme, élégant, photo pleine carte ou logo : choisissez un modèle, vos couleurs et votre texte (un prénom, une date, un nom de famille).'),
                    B::p('Pour une entreprise ou une association, ajoutez votre logo : <a href="' . $u('entreprise') . '">jeux de cartes personnalisés pour les entreprises</a>.'),
                ],
                [B::image($img('dos'), 'Quatre modèles de dos de cartes personnalisés')],
            ], true),
            B::h('Imprimé dans notre atelier'),
            B::p('Nous sommes imprimeurs. Chaque jeu est imprimé en numérique haute définition sur une presse Xerox Iridesse, sur carton couché mat 350 g ou carte graphique 300 g, puis coupé et assemblé dans notre atelier. <a href="' . $u('atelier') . '">Découvrir l’atelier</a>.'),
            B::h('Une idée de cadeau personnalisé'),
            B::ul([
                '<a href="' . $u('famille') . '">Un jeu de cartes photo pour la famille</a> : les grands-parents en roi et en dame, les petits-enfants en valets.',
                '<a href="' . $u('mariage') . '">Un jeu de cartes de mariage</a> : les mariés, les témoins, et la date sur le dos.',
                '<a href="' . $pr('belote') . '">Un jeu de belote personnalisé</a> pour les parties entre amis.',
            ]),
            B::h('Questions fréquentes'),
            $faq($faq_common),
            B::p('<a href="' . $u('faq') . '">Toutes les questions</a>'),

            // Bandeau final
            B::group([
                B::h('Donnez-vous carte blanche.'),
                B::buttons([['Créer mon jeu →', $pr('jeu-54'), 'light']]),
            ], 'cb-cta', 'felt', 'paper', 'clamp(32px, 5vw, 64px)', 'flow'),
        ]),
    ],

    // --- Comment ça marche --------------------------------------------------------------------
    'comment-ca-marche' => [
        'title' => 'Comment créer son jeu de cartes personnalisé',
        'slug' => 'comment-ca-marche',
        'focus' => 'créer son jeu de cartes',
        'seo_title' => 'Comment créer son jeu de cartes personnalisé en ligne | %site%',
        'seo_desc' => 'Créer un jeu de cartes personnalisé en 3 étapes : choisir le dos, ajouter les visages sur les figures, valider. Ou déposer votre propre fichier PDF.',
        'content' => B::join([
            B::p('Deux façons de faire votre jeu : le <strong>créer en ligne</strong> dans notre studio, ou <strong>déposer votre fichier PDF</strong> si vous l’avez préparé vous-même.', false, true),
            B::h('Créer son jeu en ligne'),
            $steps,
            B::h('Étape 1 : le dos', 3),
            B::p('Choisissez parmi huit modèles. Réglez les couleurs du fond et du texte, écrivez un titre (un prénom, un nom de famille, un événement) et un texte secondaire (une date, un lieu). Le modèle photo accepte une photo pleine carte, les modèles logo accueillent le logo de votre entreprise.'),
            B::h('Étape 2 : les visages', 3),
            B::p('Ajoutez une ou plusieurs photos : chaque tête est détourée automatiquement. Glissez ensuite un visage sur chaque figure (roi, dame, valet), ajustez sa taille et sa position. Le bouton « Remplir les figures vides » répartit vos photos en un clic.'),
            B::h('Étape 3 : la validation', 3),
            B::p('Nous fabriquons les cartes en qualité d’impression et les contrôlons. Vous voyez le rendu final avant l’ajout au panier : ce que vous voyez est ce qui sera imprimé.'),
            B::h('Déposer son fichier PDF'),
            B::p('Sur la fiche produit, choisissez « J’ai mon fichier PDF ». Votre fichier est vérifié automatiquement : nombre de pages, format, fond perdu. S’il y a un problème, nous vous expliquons comment le corriger. <a href="' . $u('guide-pdf') . '">Préparer son fichier PDF</a>.'),
            B::h('Après la commande'),
            B::ol([
                'Votre jeu part en impression dans notre atelier.',
                'Il est coupé, assemblé et contrôlé.',
                'Il vous est expédié. ' . B::todo('transporteur et délai'),
            ]),
            $cta(),
        ]),
    ],

    // --- Atelier ---------------------------------------------------------------------------
    'atelier' => [
        'title' => 'Notre atelier d’impression',
        'slug' => 'atelier',
        'focus' => 'impression jeu de cartes',
        'seo_title' => 'Notre atelier d’impression de jeux de cartes | %site%',
        'seo_desc' => 'Vos jeux de cartes personnalisés sont imprimés dans notre atelier sur une presse numérique Xerox Iridesse, sur carton couché mat 350 g, puis coupés et contrôlés à la main.',
        'content' => B::join([
            B::p('Carte Blanche est née dans un atelier d’impression. Nous ne sous-traitons pas : chaque jeu est imprimé, coupé et contrôlé chez nous.', false, true),
            B::p(B::todo('photo de l’atelier ou de la presse')),
            B::h('La presse'),
            B::p('Nous imprimons sur une <strong>Xerox Iridesse</strong>, une presse numérique de production haute définition. Les couleurs sont gérées avec un profil adapté à notre papier, pour des visages naturels et des rouges francs.'),
            B::h('Le carton'),
            B::table([
                ['Carton standard', 'Couché mat 350 g'],
                ['Carton au choix', 'Carte graphique 300 g'],
                ['Format des cartes', '63,5 × 88,9 mm (format poker)'],
                ['Impression', 'Recto verso, couleur'],
                ['Finition', 'Coins arrondis'],
            ]),
            B::h('La fabrication'),
            B::p('Les cartes de plusieurs jeux sont imprimées ensemble sur de grandes feuilles, puis coupées au massicot. Chaque jeu est assemblé dans l’ordre et vérifié avant expédition. ' . B::todo('étui, finitions')),
            B::h('Qui sommes-nous'),
            B::p(B::todo('histoire de l’atelier, ville, équipe')),
            $cta(),
        ]),
    ],

    // --- Entreprises -----------------------------------------------------------------------
    'entreprise' => [
        'title' => 'Jeu de cartes personnalisé pour entreprise',
        'slug' => 'jeu-de-cartes-personnalise-entreprise',
        'focus' => 'jeu de cartes personnalisé entreprise',
        'seo_title' => 'Jeu de cartes personnalisé avec logo pour entreprise | %site%',
        'seo_desc' => 'Jeux de cartes publicitaires avec votre logo : cadeau client, séminaire, goodies. Dos à vos couleurs, figures avec les visages de l’équipe. Devis pour les quantités.',
        'content' => B::join([
            B::columns([
                [
                    B::p('Un objet que l’on garde et que l’on sort à chaque partie : le <strong>jeu de cartes personnalisé avec votre logo</strong> est un cadeau d’entreprise qui dure.', false, true),
                    B::buttons([['Créer un jeu avec mon logo', $pr('jeu-54')], ['Demander un devis', $u('contact'), true]]),
                ],
                [B::image($img('entreprise'), 'Dos de cartes personnalisés avec un logo et un nom d’entreprise')],
            ], true),
            B::h('Pour quelles occasions ?'),
            B::ul([
                '<strong>Cadeau client</strong> ou de fin d’année, à vos couleurs.',
                '<strong>Séminaire et team building</strong> : les visages de l’équipe sur les figures.',
                '<strong>Goodies et objets publicitaires</strong> pour un salon ou un événement.',
                '<strong>Restaurants, bars, clubs</strong> : un jeu de belote à votre nom pour vos clients.',
            ]),
            B::h('Votre logo sur le dos des cartes'),
            B::p('Deux modèles sont prévus pour les logos : logo centré, ou logo en motif répété. Un logo sur fond transparent (PNG) peut être teinté dans la couleur de votre choix. Ajoutez un nom et un slogan, réglez les couleurs de votre charte.'),
            B::h('Quantités et devis'),
            B::p('Vous pouvez commander directement en ligne, quel que soit le nombre de jeux. Pour les grandes quantités, un étui personnalisé ou une livraison groupée, contactez-nous. ' . B::todo('tarifs dégressifs')),
            B::buttons([['Nous contacter', $u('contact')]]),
            B::h('Questions fréquentes'),
            $faq([
                ['Quel format de logo envoyer ?', 'Un PNG sur fond transparent donne le meilleur résultat, en 1 000 pixels de large au minimum. Un JPEG convient aussi.'],
                ['Peut-on mettre des visages différents sur chaque figure ?', 'Oui : les douze figures peuvent recevoir chacune un visage différent.'],
                ['Faites-vous des factures pour les entreprises ?', 'Oui, chaque commande donne lieu à une facture au nom de votre entreprise.'],
            ]),
            $cta('Créez le jeu de votre entreprise'),
        ]),
    ],

    // --- Famille ---------------------------------------------------------------------------
    'famille' => [
        'title' => 'Jeu de cartes photo de famille',
        'slug' => 'jeu-de-cartes-photo-famille',
        'focus' => 'jeu de cartes photo',
        'seo_title' => 'Jeu de cartes photo de famille : le cadeau personnalisé | %site%',
        'seo_desc' => 'Offrez un jeu de cartes photo avec toute la famille : grands-parents en rois et dames, enfants en valets. Un cadeau personnalisé pour Noël, un anniversaire ou la fête des grands-mères.',
        'content' => B::join([
            B::p('Mamie en dame de cœur, papi en roi de pique, les petits-enfants en valets : un <strong>jeu de cartes photo</strong> que toute la famille voudra sortir après le repas.', false, true),
            B::image($img('hero'), 'Jeu de cartes photo de famille personnalisé'),
            B::h('Un cadeau pour toutes les occasions'),
            B::ul(['Noël et les fêtes de fin d’année', 'Un anniversaire', 'La fête des grands-mères, des pères ou des mères', 'Une réunion de famille ou des vacances ensemble']),
            B::h('Comment répartir la famille ?'),
            B::p('Un jeu classique compte douze figures : quatre rois, quatre dames et quatre valets. Placez un visage par figure, ou la même personne sur plusieurs cartes. Au dos, écrivez le nom de la famille et une date.'),
            B::h('Des photos simples suffisent'),
            B::p('Une photo de face prise au smartphone suffit : la tête est détourée automatiquement. Vos photos ne quittent pas votre ordinateur, seules les cartes finales nous sont envoyées.'),
            $cta('Créez le jeu de votre famille'),
        ]),
    ],

    // --- Mariage ---------------------------------------------------------------------------
    'mariage' => [
        'title' => 'Jeu de cartes personnalisé pour un mariage',
        'slug' => 'jeu-de-cartes-mariage',
        'focus' => 'jeu de cartes mariage',
        'seo_title' => 'Jeu de cartes personnalisé mariage : cadeau invités et témoins | %site%',
        'seo_desc' => 'Un jeu de cartes de mariage à vos noms : les mariés en roi et dame, les témoins en valets, la date au dos. Cadeau d’invités, animation de table ou souvenir.',
        'content' => B::join([
            B::p('Les mariés en roi et dame de cœur, les témoins en valets, vos prénoms et la date au dos : un <strong>jeu de cartes de mariage</strong> qui reste bien après la fête.', false, true),
            B::image($img('dos'), 'Dos de cartes personnalisés pour un mariage'),
            B::h('Des idées pour votre mariage'),
            B::ul([
                '<strong>Cadeau pour les témoins</strong>, avec leur visage sur les figures.',
                '<strong>Animation de table</strong> au vin d’honneur ou en fin de soirée.',
                '<strong>Souvenir</strong> pour les mariés, ou cadeau d’anniversaire de mariage.',
            ]),
            B::h('Le dos : vos prénoms et la date'),
            B::p('Le modèle élégant ou art déco met en valeur « Chloé & Hugo » et « 12 · 06 · 2027 ». Choisissez les couleurs de votre mariage, ou une photo de vous deux en pleine carte.'),
            B::h('Plusieurs jeux ?'),
            B::p('Pour offrir un jeu à chaque table ou à chaque invité, commandez la quantité voulue sur la fiche produit, ou <a href="' . $u('contact') . '">contactez-nous</a> pour un devis.'),
            $cta('Créez votre jeu de mariage'),
        ]),
    ],

    // --- FAQ -------------------------------------------------------------------------------
    'faq' => [
        'title' => 'Questions fréquentes',
        'slug' => 'faq',
        'focus' => 'jeu de cartes personnalisé',
        'seo_title' => 'Jeu de cartes personnalisé : questions fréquentes | %site%',
        'seo_desc' => 'Photos, fichiers PDF, papier, délais, livraison, retours : toutes les réponses sur nos jeux de cartes personnalisés.',
        'content' => B::join([
            B::h('Créer son jeu'),
            $faq(array_merge(array_slice($faq_common, 0, 4), [
                ['Faut-il mettre un visage sur toutes les figures ?', 'Non : les figures sans visage gardent leur dessin classique. Vous pouvez personnaliser une seule carte ou les douze.'],
                ['Puis-je modifier ma création après validation ?', 'Oui, tant qu’elle n’est pas commandée : revenez sur la fiche produit et modifiez-la, puis validez à nouveau.'],
                ['Le jeu de belote a-t-il des figures personnalisables ?', 'Oui : le jeu de 32 cartes comporte les mêmes douze figures que le jeu de 54 cartes.'],
            ])),
            B::h('Le jeu'),
            $faq([
                ['Quel est le format des cartes ?', '63,5 × 88,9 mm, le format poker standard.'],
                ['Sur quel papier imprimez-vous ?', 'Sur carton couché mat 350 g, ou carte graphique 300 g selon le jeu.'],
                ['Que contient un jeu de 54 cartes ?', 'Les 52 cartes classiques et 2 jokers. ' . B::todo('étui, carte supplémentaire éventuelle')],
            ]),
            B::h('Commande et livraison'),
            $faq([
                ['Quels sont les délais ?', B::todo('délai de fabrication et de livraison')],
                ['Livrez-vous hors de France ?', B::todo('pays livrés')],
                ['Puis-je annuler ou retourner mon jeu ?', 'Un jeu personnalisé est fabriqué pour vous : le droit de rétractation ne s’applique pas (article L221-28 du Code de la consommation). En cas de défaut d’impression, nous le refaisons. Voir nos <a href="' . $u('cgv') . '">conditions générales de vente</a>.'],
                ['Comment payer ?', 'Par carte bancaire, paiement sécurisé. ' . B::todo('autres moyens de paiement')],
            ]),
            $cta(),
        ]),
    ],

    // --- Guide PDF -------------------------------------------------------------------------
    'guide-pdf' => [
        'title' => 'Créer son jeu de cartes en PDF : format et fond perdu',
        'slug' => 'creer-son-jeu-de-cartes-en-pdf',
        'focus' => 'imprimer son jeu de cartes',
        'seo_title' => 'Imprimer son jeu de cartes : format PDF, fond perdu, gabarit | %site%',
        'seo_desc' => 'Préparer le fichier PDF de son jeu de cartes : format 69,5 × 94,9 mm avec fond perdu, ordre des pages, résolution et couleurs. Guide pour faire imprimer son propre jeu.',
        'content' => B::join([
            B::p('Vous avez dessiné votre propre jeu ? Nous l’imprimons. Voici comment préparer votre fichier pour qu’il passe le contrôle du premier coup.', false, true),
            B::h('Le format des pages'),
            B::table([
                ['Format fini de la carte', '63,5 × 88,9 mm'],
                ['Fond perdu', '3 mm de chaque côté'],
                ['Format de chaque page du PDF', '69,5 × 94,9 mm'],
                ['Marge de sécurité', 'Textes et éléments importants à 4 mm au moins du bord de la carte'],
                ['Résolution des images', '300 à 350 dpi à la taille d’impression'],
            ]),
            B::p('Le <strong>fond perdu</strong> est la partie de l’image qui dépasse du bord de la carte et disparaît à la coupe : il évite un liseré blanc si la coupe varie d’une fraction de millimètre. Prolongez vos fonds et vos images jusqu’au bord de la page.'),
            B::h('L’ordre des pages'),
            B::ul([
                '<strong>Jeu de 54 cartes</strong> : 55 pages. Le dos en page 1, puis les 54 faces.',
                '<strong>Jeu de belote</strong> : 33 pages. Le dos en page 1, puis les 32 faces.',
            ]),
            B::p('Ordre des faces : pique, cœur, carreau, trèfle ; dans chaque couleur, de l’as au roi (as, 2 à 10, valet, dame, roi) ; puis les jokers. ' . B::todo('lien de téléchargement du gabarit')),
            B::ul([
                '<strong>Jeu photo (un dos par carte)</strong> : 108 pages, en alternant face 1, dos 1, face 2, dos 2…',
                '<strong>Jeu de bridge</strong> : 55 pages au format bridge (63,2 × 94,9 mm avec le fond perdu).',
                '<strong>Oracle</strong> : le dos en page 1, puis une page par carte, de 22 à 100 cartes, au format tarot (76 × 126 mm avec le fond perdu) ou poker.',
            ]),
            B::h('Les couleurs'),
            B::p('Les fichiers en RVB ou en CMJN sont acceptés : nous les convertissons pour notre presse avec un profil adapté au papier. Évitez les noirs composés de quatre couleurs dans les petits textes.'),
            B::h('Le contrôle automatique'),
            B::p('Dès l’envoi, votre fichier est vérifié : nombre de pages, format, présence du fond perdu. Vous voyez un aperçu et, en cas de problème, ce qu’il faut corriger. Le bouton « Ajouter au panier » n’apparaît que lorsque le fichier est prêt.'),
            B::buttons([['Envoyer mon fichier', $pr('jeu-54')]]),
        ]),
    ],

    // --- Livraison -------------------------------------------------------------------------
    'livraison' => [
        'title' => 'Livraison et délais',
        'slug' => 'livraison',
        'focus' => 'livraison jeu de cartes personnalisé',
        'seo_title' => 'Livraison et délais de fabrication | %site%',
        'seo_desc' => 'Délais de fabrication, modes de livraison et tarifs d’expédition de nos jeux de cartes personnalisés.',
        'content' => B::join([
            B::h('Fabrication'),
            B::p('Votre jeu est imprimé dans notre atelier après la validation du paiement. ' . B::todo('délai de fabrication en jours ouvrés')),
            B::h('Expédition'),
            B::table([
                ['Transporteur', B::todo('Colissimo, Mondial Relay…')],
                ['Délai de livraison', B::todo('délai')],
                ['Tarif', B::todo('tarif ou seuil de gratuité')],
                ['Pays livrés', B::todo('France, Belgique…')],
            ]),
            B::h('Suivi'),
            B::p('Un e-mail avec le numéro de suivi vous est envoyé dès l’expédition.'),
            B::h('Un problème ?'),
            B::p('Si votre colis arrive abîmé ou si votre jeu présente un défaut, <a href="' . $u('contact') . '">contactez-nous</a> avec une photo : nous le refaisons.'),
        ]),
    ],

    // --- Contact ---------------------------------------------------------------------------
    'contact' => [
        'title' => 'Contact',
        'slug' => 'contact',
        'seo_title' => 'Contact et devis | %site%',
        'seo_desc' => 'Une question sur votre jeu de cartes personnalisé, une commande en quantité ou un devis entreprise ? Contactez l’atelier.',
        'content' => B::join([
            B::p('Une question sur une commande, un projet pour votre entreprise ou votre événement ? Écrivez-nous, nous répondons sous ' . B::todo('délai de réponse') . '.', false, true),
            B::table([
                ['E-mail', B::todo('adresse e-mail')],
                ['Téléphone', B::todo('numéro')],
                ['Atelier', B::todo('adresse')],
                ['Horaires', B::todo('horaires')],
            ]),
            B::p('Pour une commande en cours, indiquez votre numéro de commande.'),
        ]),
    ],

    // --- Mentions légales ------------------------------------------------------------------
    'mentions' => [
        'title' => 'Mentions légales',
        'slug' => 'mentions-legales',
        'seo_title' => 'Mentions légales | %site%',
        'seo_desc' => 'Mentions légales du site : éditeur, hébergeur, propriété intellectuelle.',
        'noindex' => true,
        'content' => B::join([
            B::h('Éditeur du site'),
            B::p('Raison sociale : ' . B::todo('raison sociale') . '<br>Forme juridique et capital : ' . B::todo('forme, capital') . '<br>Siège : ' . B::todo('adresse') . '<br>SIRET : ' . B::todo('SIRET') . ' · RCS : ' . B::todo('ville') . '<br>TVA intracommunautaire : ' . B::todo('numéro de TVA') . '<br>Contact : ' . B::todo('e-mail, téléphone')),
            B::p('Directeur de la publication : ' . B::todo('nom')),
            B::h('Hébergeur'),
            B::p('OVH SAS, 2 rue Kellermann, 59100 Roubaix, France.'),
            B::h('Propriété intellectuelle'),
            B::p('Les textes, images et modèles de ce site sont la propriété de l’éditeur, sauf mention contraire. Les dessins des figures sont issus d’un jeu de cartes placé dans le domaine public (licence CC0). Les photos et fichiers envoyés par les clients restent leur propriété.'),
            B::h('Données personnelles'),
            B::p('Voir notre <a href="' . $u('confidentialite') . '">politique de confidentialité</a>.'),
        ]),
    ],

    // --- CGV -------------------------------------------------------------------------------
    'cgv' => [
        'title' => 'Conditions générales de vente',
        'slug' => 'conditions-generales-de-vente',
        'seo_title' => 'Conditions générales de vente | %site%',
        'seo_desc' => 'Conditions générales de vente des jeux de cartes personnalisés.',
        'noindex' => true,
        'content' => B::join([
            B::p('<em>Modèle à faire relire par un professionnel du droit avant la mise en ligne.</em>'),
            B::h('1. Objet'),
            B::p('Les présentes conditions régissent la vente en ligne de jeux de cartes personnalisés par ' . B::todo('raison sociale, SIRET, adresse') . ' (« le vendeur ») à tout client, consommateur ou professionnel (« le client »). Toute commande vaut acceptation des présentes conditions.'),
            B::h('2. Produits'),
            B::p('Les produits sont des jeux de cartes fabriqués à la demande selon les choix du client : dos, photos, textes, logo, ou fichier PDF fourni par le client. Le rendu présenté avant commande est une simulation fidèle ; de légers écarts de teinte entre l’écran et l’impression sont possibles.'),
            B::h('3. Contenus fournis par le client'),
            B::p('Le client garantit détenir les droits sur les photos, images, logos et textes qu’il utilise, et avoir l’accord des personnes représentées. Il s’interdit tout contenu illicite, diffamatoire ou portant atteinte aux droits de tiers. Le vendeur peut refuser d’imprimer un contenu manifestement illicite ; la commande est alors remboursée.'),
            B::h('4. Prix'),
            B::p('Les prix sont indiqués en euros, toutes taxes comprises, hors frais de livraison précisés avant la validation de la commande.'),
            B::h('5. Commande et paiement'),
            B::p('La commande est ferme après validation du paiement. Le paiement s’effectue par ' . B::todo('moyens de paiement') . ', au moyen d’un service de paiement sécurisé. Une facture est émise pour chaque commande.'),
            B::h('6. Fabrication et livraison'),
            B::p('Les jeux sont fabriqués après la validation du paiement, dans un délai de ' . B::todo('délai') . ', puis expédiés à l’adresse indiquée par le client. ' . B::todo('modes et délais de livraison') . ' En cas de retard, le client peut exercer les droits prévus aux articles L216-1 et suivants du Code de la consommation.'),
            B::h('7. Droit de rétractation'),
            B::p('Conformément à l’article L221-28, 3° du Code de la consommation, le droit de rétractation ne peut être exercé pour les biens confectionnés selon les spécifications du consommateur ou nettement personnalisés. Les jeux de cartes personnalisés entrent dans cette catégorie.'),
            B::h('8. Garanties'),
            B::p('Les produits bénéficient de la garantie légale de conformité (articles L217-3 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 et suivants du Code civil). En cas de défaut d’impression ou de fabrication, le vendeur refait le jeu ou le rembourse. Le vendeur n’est pas responsable des défauts provenant des fichiers ou photos fournis par le client (faible résolution, fautes de frappe, fichier non conforme accepté par le client).'),
            B::h('9. Réclamations et médiation'),
            B::p('Toute réclamation est à adresser à ' . B::todo('e-mail') . '. En cas de litige non résolu, le client consommateur peut recourir gratuitement au médiateur de la consommation : ' . B::todo('nom et coordonnées du médiateur') . '.'),
            B::h('10. Données personnelles'),
            B::p('Voir la <a href="' . $u('confidentialite') . '">politique de confidentialité</a>.'),
            B::h('11. Droit applicable'),
            B::p('Les présentes conditions sont soumises au droit français.'),
        ]),
    ],

    // --- Confidentialité -------------------------------------------------------------------
    'confidentialite' => [
        'title' => 'Politique de confidentialité',
        'slug' => 'politique-de-confidentialite',
        'seo_title' => 'Politique de confidentialité | %site%',
        'seo_desc' => 'Comment nous traitons vos données personnelles et vos photos.',
        'noindex' => true,
        'content' => B::join([
            B::p('<em>Modèle à faire relire avant la mise en ligne.</em>'),
            B::h('Responsable du traitement'),
            B::p(B::todo('raison sociale, adresse, e-mail de contact')),
            B::h('Vos photos'),
            B::p('Lorsque vous créez un jeu en ligne, le détourage des visages est réalisé <strong>dans votre navigateur</strong> : vos photos d’origine ne nous sont pas envoyées. Nous recevons uniquement les cartes finales (le dos et les figures personnalisées) nécessaires à l’impression, ou le fichier PDF que vous déposez. Ces fichiers servent exclusivement à fabriquer votre commande et sont supprimés ' . B::todo('durée, par ex. 3 mois après l’expédition') . '. Les créations non commandées sont supprimées ' . B::todo('durée') . '.'),
            B::h('Données de commande'),
            B::p('Nom, adresses, e-mail et téléphone servent à traiter et livrer votre commande, et à établir la facture. Ils sont conservés le temps de la relation commerciale, puis archivés pendant la durée légale (10 ans pour les pièces comptables).'),
            B::h('Destinataires'),
            B::ul([
                'Le prestataire de paiement, pour le règlement de la commande ' . B::todo('Stripe…'),
                'Le transporteur, pour la livraison ' . B::todo('transporteur'),
                'Notre outil de facturation et de comptabilité ' . B::todo('Sellsy, Pennylane'),
                'Notre hébergeur, OVH (France)',
            ]),
            B::p('Nous ne vendons ni ne louons vos données.'),
            B::h('Cookies'),
            B::p('Le site utilise des cookies nécessaires à son fonctionnement : panier, session de création (pour retrouver votre jeu en cours) et connexion à votre compte. ' . B::todo('mesure d’audience ou autres cookies éventuels')),
            B::h('Vos droits'),
            B::p('Vous pouvez accéder à vos données, les rectifier, les effacer, vous opposer à leur traitement ou demander leur portabilité en écrivant à ' . B::todo('e-mail') . '. Vous pouvez également adresser une réclamation à la CNIL (cnil.fr).'),
        ]),
    ],
];
