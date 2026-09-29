<?php
/**
 * Mise en place du site en un clic : images, produits, pages rédigées (blocs natifs), menus,
 * page d'accueil, permaliens et réglages WooCommerce. Relançable sans doublon : ce qui existe
 * déjà (même adresse) n'est jamais écrasé.
 *
 * Référencement : titre et description de chaque page sont enregistrés pour Yoast et Rank Math ;
 * sans extension SEO, le plugin les affiche lui-même.
 */

defined('ABSPATH') || exit;

final class CB_Setup
{
    private const OPTION = 'cb_setup';
    private const CATEGORY = ['Jeux de cartes personnalisés', 'jeux-de-cartes-personnalises'];

    private const IMAGES = [
        'hero' => ['jeu-de-cartes-personnalise.jpg', 'Jeu de cartes personnalisé : dos personnalisés, roi et dame'],
        'dos' => ['dos-de-cartes-personnalises.jpg', 'Modèles de dos de cartes personnalisés'],
        'figures' => ['figures-roi-dame-valet.jpg', 'Roi, dame et valet de cœur'],
        'entreprise' => ['jeu-de-cartes-entreprise.jpg', 'Dos de cartes personnalisés pour une entreprise'],
        'p54' => ['jeu-54-cartes-personnalise.jpg', 'Jeu de 54 cartes personnalisé'],
        'belote' => ['jeu-de-belote-personnalise.jpg', 'Jeu de belote personnalisé'],
    ];

    private const PRODUCTS = [
        'jeu-54' => [
            'name' => 'Jeu de 54 cartes personnalisé', 'slug' => 'jeu-de-54-cartes-personnalise', 'deck' => '54', 'price' => '34.90', 'image' => 'p54',
            'short' => 'Votre jeu de 54 cartes (52 cartes et 2 jokers) avec vos visages sur les rois, dames et valets, et un dos à votre image. Ou envoyez votre propre fichier PDF.',
            'seo_title' => 'Jeu de 54 cartes personnalisé avec photos | %site%',
            'seo_desc' => 'Créez votre jeu de 54 cartes personnalisé : vos visages sur les 12 figures, un dos à vos couleurs avec prénom, date ou logo. Imprimé sur carton 350 g dans notre atelier.',
        ],
        'belote' => [
            'name' => 'Jeu de belote personnalisé (32 cartes)', 'slug' => 'jeu-de-belote-personnalise', 'deck' => '32', 'price' => '29.90', 'image' => 'belote',
            'short' => 'Le jeu de 32 cartes pour la belote et la manille, avec vos visages sur les figures et un dos à votre nom.',
            'seo_title' => 'Jeu de belote personnalisé avec photos, 32 cartes | %site%',
            'seo_desc' => 'Jeu de belote personnalisé de 32 cartes : vos visages sur les rois, dames et valets, un dos à votre nom. Idéal pour un club, un bar ou un cadeau.',
        ],
    ];

    private const MAIN_MENU = [['product', 'jeu-54', 'Créer mon jeu'], ['product', 'belote', 'Jeu de belote'], ['page', 'entreprise', 'Entreprises'],
        ['page', 'comment-ca-marche', 'Comment ça marche'], ['page', 'faq', 'FAQ']];
    private const FOOTER_MENU = [['page', 'atelier', 'L’atelier'], ['page', 'livraison', 'Livraison'], ['page', 'guide-pdf', 'Fichier PDF'], ['page', 'contact', 'Contact'],
        ['page', 'mentions', 'Mentions légales'], ['page', 'cgv', 'CGV'], ['page', 'confidentialite', 'Confidentialité']];

    private static array $log = [];
    private static array $state = [];

    public static function init(): void
    {
        add_action('init', [self::class, 'patterns']);
        add_filter('pre_get_document_title', [self::class, 'document_title'], 20);
        add_action('wp_head', [self::class, 'meta_description'], 1);
        add_filter('wp_robots', [self::class, 'robots']);
    }

    public static function state(): array
    {
        return wp_parse_args(get_option(self::OPTION, []), ['images' => [], 'products' => [], 'pages' => [], 'done_at' => null]);
    }

    private static function log(string $status, string $what, ?int $post_id = null): void
    {
        self::$log[] = [$status, $what, $post_id];
    }

    /** @return array<int, array{0:string,1:string,2:?int}> journal : état (créé, existant, réglé, ignoré), libellé, contenu */
    public static function run(): array
    {
        self::$log = [];
        self::$state = self::state();
        if (!class_exists('WooCommerce')) {
            self::log('ignoré', 'WooCommerce n’est pas activé sur ce site : activez-le puis relancez.');
            return self::$log;
        }
        self::permalinks();
        self::images();
        self::products();
        self::pages();
        self::cleanup_defaults();
        self::menus();
        self::settings();
        self::$state['done_at'] = time();
        update_option(self::OPTION, self::$state, false);
        flush_rewrite_rules(false);
        return self::$log;
    }

    // --- Étapes ----------------------------------------------------------------------------------

    private static function permalinks(): void
    {
        if (!get_option('permalink_structure')) {
            update_option('permalink_structure', '/%postname%/');
            self::log('réglé', 'Permaliens : /nom-de-la-page/');
        }
        $wc = (array) get_option('woocommerce_permalinks', []);
        if (empty($wc['product_base']) || $wc['product_base'] === 'product') {
            $wc['product_base'] = 'jeu';
            update_option('woocommerce_permalinks', $wc);
            self::log('réglé', 'Adresse des produits : /jeu/nom-du-jeu/');
        }
        global $wp_rewrite;
        $wp_rewrite->init();
    }

    private static function images(): void
    {
        require_once ABSPATH . 'wp-admin/includes/image.php';
        foreach (self::IMAGES as $key => [$file, $alt]) {
            $id = self::$state['images'][$key] ?? 0;
            if ($id && get_post($id)) {
                continue;
            }
            $upload = wp_upload_bits($file, null, (string) file_get_contents(CB_DIR . "/setup/img/$file"));
            if (!empty($upload['error'])) {
                self::log('ignoré', "Image $file : {$upload['error']}");
                continue;
            }
            $id = wp_insert_attachment(['post_title' => $alt, 'post_name' => "illustration-$key", 'post_mime_type' => 'image/jpeg', 'post_status' => 'inherit'], $upload['file']);
            wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $upload['file']));
            update_post_meta($id, '_wp_attachment_image_alt', $alt);
            self::$state['images'][$key] = $id;
            self::log('créé', "Illustration : $alt (à remplacer par vos photos)", $id);
        }
    }

    private static function products(): void
    {
        $term = term_exists(self::CATEGORY[1], 'product_cat') ?: wp_insert_term(self::CATEGORY[0], 'product_cat', ['slug' => self::CATEGORY[1]]);
        $term_id = is_wp_error($term) ? 0 : (int) $term['term_id'];
        foreach (self::PRODUCTS as $key => $p) {
            $id = self::$state['products'][$key] ?? 0;
            if (!$id || !get_post($id)) {
                $id = self::find($p['slug'], 'product');
            }
            if ($id) {
                self::$state['products'][$key] = $id;
                self::log('existant', "Produit : {$p['name']} (laissé tel quel)", $id);
                continue;
            }
            $product = new WC_Product_Simple();
            $product->set_name($p['name']);
            $product->set_slug($p['slug']);
            $product->set_status('publish');
            $product->set_regular_price($p['price']);
            $product->set_short_description($p['short']);
            $product->set_description(self::product_description($p['deck']));
            if ($term_id) {
                $product->set_category_ids([$term_id]);
            }
            if ($image = self::$state['images'][$p['image']] ?? 0) {
                $product->set_image_id($image);
            }
            $id = $product->save();
            update_post_meta($id, '_cb_deck', $p['deck']);
            update_post_meta($id, '_cb_media', 'cmdm-350g');
            self::seo($id, $p['seo_title'], $p['seo_desc']);
            self::$state['products'][$key] = $id;
            self::log('créé', "Produit : {$p['name']} — prix provisoire {$p['price']} € à vérifier", $id);
        }
    }

    /** Contenu existant de ce type à cette adresse (get_page_by_path mélange pages et médias). */
    private static function find(string $slug, string $type): int
    {
        $ids = get_posts(['name' => $slug, 'post_type' => $type, 'post_status' => ['publish', 'draft', 'pending', 'private', 'future'], 'numberposts' => 1, 'fields' => 'ids']);
        return (int) ($ids[0] ?? 0);
    }

    private static function product_description(string $deck): string
    {
        $cards = $deck === '32' ? '32 cartes (du 7 à l’as), pour la belote, la manille ou la bataille' : '54 cartes : les 52 cartes classiques et 2 jokers';
        return CB_Blocks::join([
            CB_Blocks::h('Votre jeu, vos visages'),
            CB_Blocks::p("Un jeu de $cards. Les douze figures (rois, dames, valets) peuvent recevoir chacune un visage : la tête est détourée automatiquement à partir de votre photo et placée en haut et en bas de la carte."),
            CB_Blocks::h('Un dos à votre image'),
            CB_Blocks::p('Huit modèles de dos : classique, art déco, rayures, monogramme, élégant, photo pleine carte, logo centré ou logo en motif. Choisissez vos couleurs, votre titre et votre texte.'),
            CB_Blocks::h('Caractéristiques'),
            CB_Blocks::table([
                ['Format', '63,5 × 88,9 mm (format poker)'],
                ['Carton', 'Couché mat 350 g'],
                ['Impression', 'Numérique haute définition, recto verso, Xerox Iridesse'],
                ['Fabrication', 'Dans notre atelier, en France'],
            ]),
            CB_Blocks::h('Votre propre fichier'),
            CB_Blocks::p('Vous avez créé votre jeu vous-même ? Choisissez « J’ai mon fichier PDF » : nombre de pages, format et fond perdu sont contrôlés automatiquement.'),
        ]);
    }

    private static function pages(): void
    {
        // 1. Les pages manquantes sont créées vides, pour que les liens entre pages soient connus
        $defs_stub = self::load_pages(fn() => '#', fn() => '#', fn() => null);
        $new = [];
        foreach ($defs_stub as $key => $def) {
            $id = self::$state['pages'][$key] ?? 0;
            if (!$id || !get_post($id) || get_post_status($id) === 'trash') {
                $id = self::find($def['slug'], 'page');
            }
            if (!$id) {
                $id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => $def['title'], 'post_name' => $def['slug'], 'post_content' => '']);
                $new[$key] = $id;
            } else {
                self::log('existant', "Page : {$def['title']} (laissée telle quelle)", $id);
            }
            self::$state['pages'][$key] = $id;
        }
        // 2. Contenu des pages créées, avec les vraies adresses
        $defs = self::load_pages(
            fn($k) => isset(self::$state['pages'][$k]) ? get_permalink(self::$state['pages'][$k]) : home_url('/'),
            fn($k) => isset(self::$state['products'][$k]) ? get_permalink(self::$state['products'][$k]) : home_url('/'),
            fn($k) => self::$state['images'][$k] ?? null,
        );
        foreach ($new as $key => $id) {
            $def = $defs[$key];
            wp_update_post(['ID' => $id, 'post_content' => wp_slash($def['content'])]);
            self::seo($id, $def['seo_title'], $def['seo_desc'], !empty($def['noindex']));
            self::log('créé', "Page : {$def['title']}", $id);
        }
    }

    private static function load_pages(callable $u, callable $pr, callable $img): array
    {
        return require CB_DIR . '/setup/pages.php';
    }

    /** Page d'exemple et premier article de WordPress : à la corbeille s'ils n'ont jamais été modifiés. */
    private static function cleanup_defaults(): void
    {
        foreach (get_posts(['post_type' => ['post', 'page'], 'post_status' => 'publish', 'numberposts' => 20, 'orderby' => 'ID', 'order' => 'ASC']) as $post) {
            if ($post->ID > 3) {
                break;
            }
            $sample = in_array($post->post_name, ['sample-page', 'page-d-exemple', 'hello-world', 'bonjour-tout-le-monde'], true);
            if ($sample && $post->post_modified_gmt === $post->post_date_gmt) {
                wp_trash_post($post->ID);
                self::log('réglé', "« {$post->post_title} » (contenu d’exemple de WordPress) mis à la corbeille");
            }
        }
    }

    private static function menus(): void
    {
        $link = function (array $item): ?array {
            [$type, $key, $label] = $item;
            $id = $type === 'product' ? (self::$state['products'][$key] ?? 0) : (self::$state['pages'][$key] ?? 0);
            return $id ? ['id' => $id, 'label' => $label, 'type' => $type === 'product' ? 'product' : 'page', 'url' => get_permalink($id)] : null;
        };
        $main = array_values(array_filter(array_map($link, self::MAIN_MENU)));
        $footer = array_values(array_filter(array_map($link, self::FOOTER_MENU)));

        // Thèmes classiques (Kadence, Astra…) : menus WordPress rattachés aux emplacements du thème
        $menu_ids = [];
        foreach (['main' => ['Menu principal', $main], 'footer' => ['Pied de page', $footer]] as $slot => [$name, $items]) {
            $menu = wp_get_nav_menu_object($name);
            if ($menu) {
                $menu_ids[$slot] = $menu->term_id;
                self::log('existant', "Menu : $name (laissé tel quel)");
                continue;
            }
            $menu_id = wp_create_nav_menu($name);
            if (is_wp_error($menu_id)) {
                continue;
            }
            foreach ($items as $i => $it) {
                wp_update_nav_menu_item($menu_id, 0, ['menu-item-title' => $it['label'], 'menu-item-object' => $it['type'], 'menu-item-object-id' => $it['id'],
                    'menu-item-type' => 'post_type', 'menu-item-status' => 'publish', 'menu-item-position' => $i + 1]);
            }
            $menu_ids[$slot] = $menu_id;
            self::log('créé', "Menu : $name");
        }
        $locations = (array) get_theme_mod('nav_menu_locations', []);
        $set = [];
        foreach (array_keys(get_registered_nav_menus()) as $loc) {
            $slot = preg_match('/footer/i', $loc) ? 'footer' : (preg_match('/primary|main|header|mobile|menu-1/i', $loc) ? 'main' : null);
            if ($slot && empty($locations[$loc]) && isset($menu_ids[$slot])) {
                $locations[$loc] = $menu_ids[$slot];
                $set[] = $loc;
            }
        }
        if ($set) {
            set_theme_mod('nav_menu_locations', $locations);
            self::log('réglé', 'Menus placés dans le thème : ' . implode(', ', $set));
        }

        // Thèmes en blocs (Twenty Twenty-Five…) : menu de navigation en blocs
        if (function_exists('wp_is_block_theme') && wp_is_block_theme() && !get_posts(['post_type' => 'wp_navigation', 'title' => 'Menu principal', 'post_status' => 'publish', 'numberposts' => 1])) {
            $blocks = implode("\n", array_map(fn($it) => '<!-- wp:navigation-link ' . wp_json_encode(['label' => $it['label'], 'type' => $it['type'], 'id' => $it['id'],
                'url' => $it['url'], 'kind' => 'post-type'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ' /-->', $main));
            wp_insert_post(['post_type' => 'wp_navigation', 'post_status' => 'publish', 'post_title' => 'Menu principal', 'post_content' => wp_slash($blocks)]);
            self::log('créé', 'Menu de navigation (thème en blocs)');
        }
    }

    private static function settings(): void
    {
        $home = self::$state['pages']['accueil'] ?? 0;
        if ($home && (get_option('show_on_front') !== 'page' || !get_option('page_on_front'))) {
            update_option('show_on_front', 'page');
            update_option('page_on_front', $home);
            self::log('réglé', 'Page d’accueil du site', $home);
        }
        $desc = get_option('blogdescription');
        if (!$desc || preg_match('/^(Just another|Un site utilisant WordPress|Un nouveau site)/i', $desc)) {
            update_option('blogdescription', 'Jeux de cartes personnalisés avec vos photos, imprimés dans notre atelier');
            self::log('réglé', 'Slogan du site');
        }
        if (in_array(get_option('timezone_string'), ['', 'UTC'], true) && !get_option('gmt_offset')) {
            update_option('timezone_string', 'Europe/Paris');
            self::log('réglé', 'Fuseau horaire : Paris');
        }
        // WooCommerce
        if (class_exists('WC_Install')) {
            WC_Install::create_pages(); // panier, commande, mon compte, boutique (s'ils manquent)
        }
        $opts = [
            'woocommerce_currency' => 'EUR', 'woocommerce_price_thousand_sep' => ' ', 'woocommerce_price_decimal_sep' => ',',
            'woocommerce_currency_pos' => 'right_space', 'woocommerce_calc_taxes' => 'yes', 'woocommerce_prices_include_tax' => 'yes',
            'woocommerce_tax_display_shop' => 'incl', 'woocommerce_tax_display_cart' => 'incl', 'woocommerce_cart_redirect_after_add' => 'yes',
            'woocommerce_weight_unit' => 'g', 'woocommerce_dimension_unit' => 'mm',
        ];
        if (!str_starts_with((string) get_option('woocommerce_default_country'), 'FR')) {
            $opts['woocommerce_default_country'] = 'FR';
        }
        if (!self::$state['done_at']) { // première mise en place seulement : vos réglages ultérieurs sont respectés
            foreach ($opts as $k => $v) {
                update_option($k, $v);
            }
        }
        if ($id = self::$state['pages']['cgv'] ?? 0) {
            update_option('woocommerce_terms_page_id', $id);
        }
        if ($id = self::$state['pages']['confidentialite'] ?? 0) {
            update_option('wp_page_for_privacy_policy', $id);
        }
        self::log('réglé', 'WooCommerce : euro, France, prix TTC, CGV et confidentialité liées au paiement, redirection vers le panier');
        global $wpdb;
        if (class_exists('WC_Tax') && !(int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}woocommerce_tax_rates")) {
            WC_Tax::_insert_tax_rate(['tax_rate_country' => 'FR', 'tax_rate' => '20.0000', 'tax_rate_name' => 'TVA', 'tax_rate_priority' => 1,
                'tax_rate_compound' => 0, 'tax_rate_shipping' => 1, 'tax_rate_order' => 0, 'tax_rate_class' => '']);
            self::log('réglé', 'TVA France 20 %');
        }
    }

    // --- Référencement ---------------------------------------------------------------------------

    private static function seo(int $id, string $title, string $desc, bool $noindex = false): void
    {
        $title = str_replace('%site%', get_bloginfo('name'), $title);
        update_post_meta($id, '_cb_seo_title', $title);
        update_post_meta($id, '_cb_seo_desc', $desc);
        // Repris par Yoast SEO ou Rank Math s'ils sont installés
        update_post_meta($id, '_yoast_wpseo_title', $title);
        update_post_meta($id, '_yoast_wpseo_metadesc', $desc);
        update_post_meta($id, 'rank_math_title', $title);
        update_post_meta($id, 'rank_math_description', $desc);
        if ($noindex) {
            update_post_meta($id, '_cb_noindex', 1);
            update_post_meta($id, '_yoast_wpseo_meta-robots-noindex', 1);
            update_post_meta($id, 'rank_math_robots', ['noindex']);
        }
    }

    private static function seo_plugin(): bool
    {
        return defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION') || defined('AIOSEO_VERSION') || defined('SEOPRESS_VERSION');
    }

    public static function document_title($title)
    {
        if (!self::seo_plugin() && is_singular() && ($t = get_post_meta(get_queried_object_id(), '_cb_seo_title', true))) {
            return $t;
        }
        return $title;
    }

    public static function meta_description(): void
    {
        if (!self::seo_plugin() && is_singular() && ($d = get_post_meta(get_queried_object_id(), '_cb_seo_desc', true))) {
            echo '<meta name="description" content="' . esc_attr($d) . "\">\n";
        }
    }

    public static function robots(array $robots): array
    {
        if (!self::seo_plugin() && is_singular() && get_post_meta(get_queried_object_id(), '_cb_noindex', true)) {
            $robots['noindex'] = true;
            $robots['follow'] = true;
        }
        return $robots;
    }

    // --- Compositions réutilisables (bouton + de l'éditeur) ---------------------------------------

    public static function patterns(): void
    {
        if (!function_exists('register_block_pattern')) {
            return;
        }
        $s = self::state();
        $p54 = isset($s['products']['jeu-54']) ? get_permalink($s['products']['jeu-54']) : home_url('/');
        $how = isset($s['pages']['comment-ca-marche']) ? get_permalink($s['pages']['comment-ca-marche']) : home_url('/');
        register_block_pattern_category('carte-blanche', ['label' => 'Carte Blanche']);
        $B = CB_Blocks::class;
        register_block_pattern('carte-blanche/appel-creer', ['title' => 'Bandeau « Créer mon jeu »', 'categories' => ['carte-blanche'],
            'content' => $B::section([$B::h('Prêt à créer votre jeu ?', 2, true), $B::p('Choisissez un dos, ajoutez vos photos : vous voyez chaque carte telle qu’elle sera imprimée.', true),
                $B::buttons([['Créer mon jeu', $p54], ['Comment ça marche', $how, true]], true)], '#F3EFE7')]);
        register_block_pattern('carte-blanche/etapes', ['title' => 'Les 3 étapes', 'categories' => ['carte-blanche'],
            'content' => $B::columns([
                [$B::h('1. Choisissez votre dos', 3), $B::p('Huit modèles à personnaliser : couleurs, texte, logo ou photo.')],
                [$B::h('2. Ajoutez vos visages', 3), $B::p('La tête est détourée automatiquement, puis glissée sur les figures.')],
                [$B::h('3. Validez et recevez', 3), $B::p('Nous contrôlons, imprimons et expédions votre jeu.')],
            ])]);
        register_block_pattern('carte-blanche/faq', ['title' => 'Questions fréquentes', 'categories' => ['carte-blanche'],
            'content' => $B::join([$B::h('Questions fréquentes'), $B::details('Votre question ?', 'Votre réponse.'), $B::details('Une autre question ?', 'Votre réponse.')])]);
    }

    // --- Suivi : ce qu'il reste à compléter --------------------------------------------------------

    /** @return array<int, array{0:int,1:string,2:int}> contenu, titre, nombre de champs à compléter */
    public static function todos(): array
    {
        $s = self::state();
        $out = [];
        foreach (array_merge(array_values($s['pages']), array_values($s['products'])) as $id) {
            $post = get_post($id);
            if ($post && $post->post_status !== 'trash' && ($n = substr_count($post->post_content, '[à compléter'))) {
                $out[] = [$id, $post->post_title, $n];
            }
        }
        return $out;
    }
}
