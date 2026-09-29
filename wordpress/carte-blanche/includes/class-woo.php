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
        // Panier
        add_filter('woocommerce_add_to_cart_validation', [self::class, 'validate_add'], 10, 3);
        add_filter('woocommerce_add_cart_item_data', [self::class, 'cart_item_data'], 10, 2);
        add_filter('woocommerce_get_item_data', [self::class, 'cart_item_display'], 10, 2);
        add_filter('woocommerce_cart_item_thumbnail', [self::class, 'cart_thumbnail'], 10, 2);
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
            'productId' => $product_id,
            'deck' => $deck,
            'cardPx' => CB_Settings::card_px($deck),
            'bleedMm' => (float) CB_Settings::get('bleed_mm'),
        ]);
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
        }
        return $lines;
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
                $count += $item->get_quantity();
            }
        }
        if ($count) {
            $order->add_order_note(sprintf('Carte Blanche : %d jeu%s transmis à la production.', $count, $count > 1 ? 'x' : ''));
        }
    }
}
