<?php
/**
 * Intégration WooCommerce.
 *
 * - Fiche produit : une case « Studio Carte Blanche » (+ jeu de 54 ou 32) transforme le produit
 *   en jeu personnalisable ; le studio remplace alors le formulaire d'ajout au panier.
 * - Panier : on n'ajoute qu'une création contrôlée (statut « approved ») du visiteur ; chaque
 *   création reste une ligne distincte, avec son aperçu.
 * - Commande : la création est rattachée à la ligne de commande, et passe « payée » avec la
 *   commande (paiement confirmé par WooCommerce).
 */

defined('ABSPATH') || exit;

final class CB_Woo
{
    public static function init(): void
    {
        // Administration du produit
        add_action('woocommerce_product_options_general_product_data', [self::class, 'product_fields']);
        add_action('woocommerce_process_product_meta', [self::class, 'save_product_fields']);
        // Fiche produit (boutique)
        add_action('woocommerce_before_add_to_cart_button', [self::class, 'studio_mount']);
        add_action('wp_enqueue_scripts', [self::class, 'assets']);
        // Listes de produits : un jeu se crée sur sa fiche, pas d'ajout direct au panier
        add_filter('woocommerce_loop_add_to_cart_link', [self::class, 'loop_button'], 10, 2);
        add_action('woocommerce_after_shop_loop_item_title', [self::class, 'loop_tagline'], 6);
        // Panier
        add_filter('woocommerce_add_to_cart_validation', [self::class, 'validate_add'], 10, 3);
        add_filter('woocommerce_add_cart_item_data', [self::class, 'cart_item_data'], 10, 2);
        add_filter('woocommerce_get_item_data', [self::class, 'cart_item_display'], 10, 2);
        add_filter('woocommerce_cart_item_thumbnail', [self::class, 'cart_thumbnail'], 10, 2);
        add_action('woocommerce_before_calculate_totals', [self::class, 'cart_prices'], 20);
        // Prix affichés : « dès … » et remises par quantité
        add_filter('woocommerce_get_price_html', [self::class, 'price_html'], 10, 2);
        add_action('woocommerce_before_add_to_cart_form', [self::class, 'tiers_table']);
        // Commande
        add_action('woocommerce_checkout_create_order_line_item', [self::class, 'order_item_meta'], 10, 3);
        add_action('woocommerce_store_api_checkout_order_processed', [self::class, 'link_order']);
        add_action('woocommerce_checkout_order_processed', [self::class, 'link_order']);
        add_action('woocommerce_order_status_processing', [self::class, 'order_paid']);
        add_action('woocommerce_order_status_completed', [self::class, 'order_paid']);
        add_filter('woocommerce_order_item_display_meta_key', [self::class, 'meta_label']);
    }

    public static function is_studio_product($product): bool
    {
        $id = is_object($product) ? $product->get_id() : (int) $product;
        return (bool) get_post_meta($id, '_cb_deck', true);
    }

    // --- Administration du produit -----------------------------------------------------------

    public static function product_fields(): void
    {
        echo '<div class="options_group">';
        woocommerce_wp_select([
            'id' => '_cb_deck',
            'label' => 'Studio Carte Blanche',
            'description' => 'Jeu personnalisable : le studio de création remplace le bouton « Ajouter au panier ».',
            'desc_tip' => true,
            'options' => ['' => 'Non (produit classique)'] + array_map(fn($d) => $d['label'], CB_Settings::decks()),
        ]);
        woocommerce_wp_select([
            'id' => '_cb_media',
            'label' => 'Carton',
            'options' => ['cmdm-350g' => 'Couché mat 350 g', 'carte-graphique-300g' => 'Carte graphique 300 g'],
        ]);
        echo '</div>';
    }

    public static function save_product_fields(int $post_id): void
    {
        $deck = sanitize_text_field($_POST['_cb_deck'] ?? '');
        update_post_meta($post_id, '_cb_deck', isset(CB_Settings::decks()[$deck]) ? $deck : '');
        $media = sanitize_text_field($_POST['_cb_media'] ?? 'cmdm-350g');
        update_post_meta($post_id, '_cb_media', in_array($media, ['cmdm-350g', 'carte-graphique-300g'], true) ? $media : 'cmdm-350g');
    }

    // --- Fiche produit ------------------------------------------------------------------------

    public static function assets(): void
    {
        if (!is_product() || !self::is_studio_product(get_queried_object_id())) {
            return;
        }
        $base = CB_URL . 'assets/studio/';
        $version = CB_VERSION . '-' . @filemtime(CB_DIR . '/assets/studio/studio.js');
        wp_enqueue_style('cb-studio', $base . 'studio.css', [], $version);
        wp_enqueue_script('cb-studio', $base . 'studio.js', [], $version, ['in_footer' => true, 'strategy' => 'defer']);
        $product_id = get_queried_object_id();
        $deck = (string) get_post_meta($product_id, '_cb_deck', true);
        wp_localize_script('cb-studio', 'CarteBlanche', [
            'rest' => esc_url_raw(rest_url('cb/v1/')),
            'nonce' => wp_create_nonce('wp_rest'),
            'assets' => CB_URL . 'assets/',
            'mediapipe' => CB_Segmenter::url(),
            'productId' => $product_id,
            'deck' => $deck,
            'spec' => self::spec_for_js($deck),
            'image' => (string) wp_get_attachment_image_url((int) get_post_thumbnail_id($product_id), 'large'),
            'cardPx' => CB_Settings::card_px($deck),
            'bleedMm' => (float) CB_Settings::get('bleed_mm'),
        ]);
    }

    public static function loop_tagline(): void
    {
        global $product;
        if ($product && ($t = get_post_meta($product->get_id(), '_cb_tagline', true))) {
            echo '<p class="cb-tagline">' . esc_html($t) . '</p>';
        }
    }

    public static function loop_button(string $html, $product): string
    {
        if (!self::is_studio_product($product)) {
            return $html;
        }
        return '<a href="' . esc_url($product->get_permalink()) . '" class="button wp-element-button">Créer mon jeu</a>';
    }

    private static function spec_for_js(string $deck): array
    {
        $d = CB_Settings::deck($deck);
        $b = 2 * (float) CB_Settings::get('bleed_mm');
        $media = [];
        foreach (CB_Settings::MEDIA as $k => $m) {
            $media[] = ['id' => $k, 'label' => $m['label'], 'hint' => $m['hint'], 'delta' => (float) ($d['pricing']['media'][$k] ?? 0)];
        }
        return [
            'cards' => $d['cards'], 'cardsMin' => $d['cards_min'] ?? null, 'cardsMax' => $d['cards_max'] ?? null,
            'backs' => $d['backs'], 'editor' => $d['editor'], 'media' => $media,
            'pricing' => $d['pricing'],
            'packs' => array_map(fn($k) => ['id' => $k, 'label' => CB_Box::PACKS[$k]['label'], 'hint' => CB_Box::PACKS[$k]['hint'], 'price' => CB_Box::price($k), 'photo' => CB_Box::photo($k),
                'formats' => CB_Box::PACKS[$k]['formats'] ?? null], array_keys(CB_Box::PACKS)),
            'caliper' => CB_Box::CALIPER,
            'formats' => array_map(fn($f) => ['key' => $f, 'label' => CB_Settings::FORMATS[$f]['label'], 'trim' => CB_Settings::FORMATS[$f]['trim'],
                'page' => array_map(fn($v) => $v + $b, CB_Settings::FORMATS[$f]['trim'])], $d['formats']),
        ];
    }

    /** Prix recalculé au panier : grille du jeu, nombre de cartes du fichier, carton, remise quantité. */
    public static function cart_prices($cart): void
    {
        if (is_admin() && !wp_doing_ajax()) {
            return;
        }
        foreach ($cart->get_cart() as $item) {
            if (empty($item['cb_job']) || !($job = CB_Store::job($item['cb_job'])) || !CB_Settings::deck($job['deck'])) {
                continue;
            }
            $price = CB_Settings::price($job['deck'], (int) $item['quantity'], $job['cards'] ? (int) $job['cards'] : null, $job['media'], $job['pack'] ?? 'film');
            $item['data']->set_price($price['unit']);
        }
    }

    public static function price_html(string $html, $product): string
    {
        $deck = self::is_studio_product($product) ? CB_Settings::deck((string) get_post_meta($product->get_id(), '_cb_deck', true)) : null;
        if (!$deck || is_cart() || is_checkout()) {
            return $html;
        }
        return '<span class="cb-from">dès</span> ' . $html;
    }

    public static function tiers_table(): void
    {
        global $product;
        $key = $product && self::is_studio_product($product) ? (string) get_post_meta($product->get_id(), '_cb_deck', true) : '';
        if (!($deck = CB_Settings::deck($key))) {
            return;
        }
        $rows = [];
        foreach ($deck['pricing']['tiers'] as [$min, $coef]) {
            if ($coef < 1) {
                $rows[] = sprintf('<li>dès %d jeux : <strong>−%d %%</strong></li>', $min, round((1 - $coef) * 100));
            }
        }
        $extra = isset($deck['cards_min']) ? sprintf('<p class="cb-note">Prix pour %d cartes : %s € + %s € par carte, calculé d’après votre fichier.</p>',
            $deck['cards_min'], number_format($deck['pricing']['unit'], 2, ',', ' '), number_format($deck['pricing']['per_card'], 2, ',', ' ')) : '';
        echo '<div class="cb-tiers"><p><strong>Remises par quantité</strong></p><ul>' . implode('', $rows) . "</ul>$extra</div>";
    }

    public static function studio_mount(): void
    {
        global $product;
        if (!$product || !self::is_studio_product($product)) {
            return;
        }
        // Le studio s'affiche ici ; il remplit le champ caché puis active le bouton quand la création est validée.
        echo '<div id="cb-studio" class="cb-studio-root" data-product="' . esc_attr($product->get_id()) . '"></div>';
        echo '<input type="hidden" name="cb_job" id="cb-job" value="">';
    }

    // --- Panier ---------------------------------------------------------------------------------

    public static function validate_add(bool $passed, int $product_id, int $qty): bool
    {
        if (!self::is_studio_product($product_id)) {
            return $passed;
        }
        $uid = sanitize_text_field($_POST['cb_job'] ?? '');
        $job = $uid ? CB_Rest::owned($uid) : null;
        if (!$job || $job['status'] !== 'approved' || (int) $job['product_id'] !== $product_id) {
            wc_add_notice('Créez votre jeu (ou déposez votre fichier) et attendez sa validation avant de l’ajouter au panier.', 'error');
            return false;
        }
        return $passed;
    }

    public static function cart_item_data(array $data, int $product_id): array
    {
        if (self::is_studio_product($product_id) && !empty($_POST['cb_job'])) {
            $data['cb_job'] = sanitize_text_field($_POST['cb_job']);
            $data['unique_key'] = $data['cb_job']; // une création = une ligne de panier
        }
        return $data;
    }

    public static function cart_item_display(array $lines, array $item): array
    {
        if (!empty($item['cb_job']) && ($job = CB_Store::job($item['cb_job']))) {
            $lines[] = ['key' => 'Création', 'value' => $job['kind'] === 'pdf' ? 'Votre fichier PDF, contrôlé' : 'Créée en ligne, contrôlée'];
            foreach (self::job_details($job) as $k => $v) {
                $lines[] = ['key' => $k, 'value' => $v];
            }
        }
        return $lines;
    }

    /** Carton, format et nombre de cartes d'une création (panier, commande, e-mails). */
    public static function job_details(array $job): array
    {
        $out = ['Carton' => CB_Settings::MEDIA[$job['media']]['label'] ?? $job['media']];
        $deck = CB_Settings::deck($job['deck']);
        if ($deck && count($deck['formats']) > 1) {
            $out['Format'] = CB_Settings::FORMATS[$job['format']]['label'] ?? $job['format'];
        }
        $out['Conditionnement'] = CB_Box::label($job['pack'] ?? 'film');
        if (CB_Production::recto($job) === 'vintage') {
            $out['Recto'] = 'Vintage';
        }
        if ($deck && isset($deck['cards_min']) && $job['cards']) {
            $out['Cartes'] = (string) $job['cards'];
        }
        return $out;
    }

    public static function cart_thumbnail(string $html, array $item): string
    {
        if (!empty($item['cb_job'])) {
            $url = rest_url("cb/v1/jobs/{$item['cb_job']}/preview/back");
            return '<img src="' . esc_url($url) . '" alt="Aperçu de votre jeu" width="96" style="border-radius:6px">';
        }
        return $html;
    }

    // --- Commande -------------------------------------------------------------------------------

    public static function order_item_meta($item, string $cart_key, array $values): void
    {
        if (!empty($values['cb_job'])) {
            $item->add_meta_data('_cb_job', $values['cb_job'], true);
            if ($job = CB_Store::job($values['cb_job'])) {
                foreach (self::job_details($job) as $k => $v) {
                    $item->add_meta_data($k, $v, true);
                }
            }
        }
    }

    public static function meta_label(string $key): string
    {
        return $key === '_cb_job' ? 'Création' : $key;
    }

    /** Relie chaque création à sa commande dès sa création (avant le paiement). */
    public static function link_order($order): void
    {
        $order = is_object($order) ? $order : wc_get_order($order);
        if (!$order) {
            return;
        }
        foreach ($order->get_items() as $item_id => $item) {
            $uid = $item->get_meta('_cb_job');
            if ($uid && ($job = CB_Store::job($uid)) && !$job['order_id']) {
                CB_Store::update_job($uid, ['order_id' => $order->get_id(), 'order_item_id' => $item_id, 'copies' => $item->get_quantity()]);
            }
        }
    }

    /** Paiement confirmé : les créations de la commande entrent en production. */
    public static function order_paid(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }
        self::link_order($order);
        $count = 0;
        foreach ($order->get_items() as $item) {
            $uid = $item->get_meta('_cb_job');
            $job = $uid ? CB_Store::job($uid) : null;
            if ($job && $job['status'] === 'approved') {
                CB_Store::update_job($uid, ['status' => 'paid', 'paid_at' => CB_Store::now(), 'copies' => $item->get_quantity()]);
                CB_Production::job_paid($uid);
                $count += $item->get_quantity();
            }
        }
        if ($count) {
            $order->add_order_note(sprintf('Carte Blanche : %d jeu%s transmis à la production.', $count, $count > 1 ? 'x' : ''));
        }
    }
}
