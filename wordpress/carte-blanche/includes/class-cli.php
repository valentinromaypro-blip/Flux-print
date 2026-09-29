<?php
/** Commandes WP-CLI : `wp carte-blanche demo` crée les produits de démonstration. */

defined('ABSPATH') || exit;

WP_CLI::add_command('carte-blanche', new class {
    /** Crée (ou met à jour) les deux jeux personnalisables de démonstration. */
    public function demo(): void
    {
        foreach ([['jeu-classique', 'Le jeu classique', '54', '34.90'], ['jeu-belote', 'Le jeu de belote', '32', '29.90']] as [$slug, $title, $deck, $price]) {
            $existing = get_page_by_path($slug, OBJECT, 'product');
            $product = $existing ? wc_get_product($existing->ID) : new WC_Product_Simple();
            $product->set_name($title);
            $product->set_slug($slug);
            $product->set_status('publish');
            $product->set_regular_price($price);
            $product->set_description('Un jeu à votre image : dos personnalisé, figures avec vos visages, ou votre propre fichier PDF.');
            $id = $product->save();
            update_post_meta($id, '_cb_deck', $deck);
            update_post_meta($id, '_cb_media', 'cmdm-350g');
            WP_CLI::success("$title : " . get_permalink($id));
        }
    }
});
