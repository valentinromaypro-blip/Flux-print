<?php
/** Administration : menu « Carte Blanche » (diagnostic de l'hébergement, puis atelier). */

defined('ABSPATH') || exit;

final class CB_Admin
{
    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'menu']);
        add_action('admin_post_cb_setup', [self::class, 'run_setup']);
    }

    public static function menu(): void
    {
        add_menu_page('Carte Blanche', 'Carte Blanche', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic'], 'dashicons-images-alt2', 56);
        add_submenu_page('carte-blanche', 'Diagnostic', 'Diagnostic', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic']);
        add_submenu_page('carte-blanche', 'Mise en place du site', 'Mise en place', 'manage_options', 'carte-blanche-setup', [self::class, 'setup']);
    }

    /** @return array<int, array{0:string,1:bool,2:string,3:string}> libellé, ok, valeur, conseil */
    public static function checks(): array
    {
        $bytes = fn($v) => (int) wp_convert_hr_to_bytes((string) $v);
        $imagick = extension_loaded('imagick') ? (Imagick::getVersion()['versionString'] ?? 'oui') : null;
        $gs = CB_Check::gs();
        $gs_version = $gs ? trim((string) @shell_exec(escapeshellarg($gs) . ' --version 2>/dev/null')) : null;
        $uploads = CB_Store::dir('');
        $mem = ini_get('memory_limit');
        return [
            ['PHP 8.1 ou plus', version_compare(PHP_VERSION, '8.1', '>='), PHP_VERSION, 'Espace client OVH → Hébergement → Version PHP globale : 8.2'],
            ['Imagick (images, profils couleur)', (bool) $imagick, $imagick ?: 'absent', 'OVH : environnement d’exécution « stable64 » (Configuration globale)'],
            ['Ghostscript (lecture des PDF)', (bool) $gs, $gs_version ? "gs $gs_version" : 'absent ou exec() désactivé', 'Nécessaire pour les PDF déposés par les clients'],
            ['Mémoire PHP ≥ 256 Mo', $mem === '-1' || $bytes($mem) >= 256 * 1048576, (string) $mem, 'OVH : activer le moteur PHP-FPM (512 Mo)'],
            ['Temps d’exécution ≥ 120 s', (int) ini_get('max_execution_time') === 0 || (int) ini_get('max_execution_time') >= 120, ini_get('max_execution_time') . ' s', 'OVH : moteur PHP-FPM (165 s)'],
            ['Taille d’envoi ≥ 8 Mo', $bytes(ini_get('upload_max_filesize')) >= 8 * 1048576 && $bytes(ini_get('post_max_size')) >= 8 * 1048576,
                ini_get('upload_max_filesize') . ' / ' . ini_get('post_max_size'), 'Les gros PDF sont envoyés par morceaux de 4 Mo'],
            ['Dossier privé des fichiers', is_writable($uploads), str_replace(ABSPATH, '', $uploads), 'Droits d’écriture sur wp-content/uploads'],
            ['WooCommerce', class_exists('WooCommerce'), defined('WC_VERSION') ? WC_VERSION : 'absent', 'Activer WooCommerce sur ce site'],
            ['Tâches de fond (Action Scheduler)', function_exists('as_enqueue_async_action'), function_exists('as_enqueue_async_action') ? 'oui' : 'non', 'Fourni par WooCommerce'],
        ];
    }

    public static function diagnostic(): void
    {
        echo '<div class="wrap"><h1>Carte Blanche · Diagnostic de l’hébergement</h1>';
        echo '<p>Ce que le plugin peut faire sur ce serveur. Tout doit être vert avant d’ouvrir la vente.</p>';
        echo '<table class="widefat striped" style="max-width:960px"><thead><tr><th>Élément</th><th>État</th><th>Valeur</th><th>Si ce n’est pas bon</th></tr></thead><tbody>';
        foreach (self::checks() as [$label, $ok, $value, $hint]) {
            printf('<tr><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s</td></tr>', esc_html($label),
                $ok ? '<span style="color:#1e7a4f;font-weight:600">✔ OK</span>' : '<span style="color:#c4172c;font-weight:600">✘ À corriger</span>',
                esc_html($value), $ok ? '' : esc_html($hint));
        }
        echo '</tbody></table>';
        self::shop_checks();
        $products = get_posts(['post_type' => 'product', 'meta_key' => '_cb_deck', 'meta_compare' => '!=', 'meta_value' => '', 'numberposts' => 20]);
        echo '<h2>Produits avec le studio</h2>';
        if (!$products) {
            echo '<p>Aucun pour l’instant : ouvrez un produit WooCommerce → onglet Général → « Studio Carte Blanche ».</p>';
        } else {
            echo '<ul>' . implode('', array_map(fn($p) => '<li><a href="' . esc_url(get_permalink($p)) . '">' . esc_html($p->post_title) . '</a></li>', $products)) . '</ul>';
        }
        echo '</div>';
    }

    public static function run_setup(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('Accès refusé.');
        }
        check_admin_referer('cb_setup');
        @set_time_limit(120);
        set_transient('cb_setup_log_' . get_current_user_id(), CB_Setup::run(), 600);
        wp_safe_redirect(admin_url('admin.php?page=carte-blanche-setup&done=1'));
        exit;
    }

    public static function setup(): void
    {
        $state = CB_Setup::state();
        $log = get_transient('cb_setup_log_' . get_current_user_id());
        $edit = fn($id) => $id ? ' · <a href="' . esc_url(get_edit_post_link($id)) . '">modifier</a> · <a href="' . esc_url(get_permalink($id)) . '">voir</a>' : '';
        echo '<div class="wrap"><h1>Carte Blanche · Mise en place du site</h1>';
        echo '<p style="max-width:760px">Crée en un clic la structure du site : les pages rédigées pour le référencement (en blocs, modifiables dans l’éditeur), les deux jeux personnalisables, les menus, la page d’accueil et les réglages WooCommerce (euro, TVA, CGV).<br>'
            . '<strong>Rien n’est écrasé</strong> : une page ou un produit qui existe déjà à la même adresse est laissé tel quel. Vous pouvez relancer sans créer de doublons.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('cb_setup');
        echo '<input type="hidden" name="action" value="cb_setup">';
        submit_button($state['done_at'] ? 'Relancer la mise en place (compléter ce qui manque)' : 'Installer la structure du site', 'primary large', 'submit', false);
        echo '</form>';

        if ($log && isset($_GET['done'])) {
            echo '<h2>Ce qui vient d’être fait</h2><table class="widefat striped" style="max-width:960px"><tbody>';
            foreach ($log as [$status, $what, $id]) {
                $color = ['créé' => '#1e7a4f', 'mis à jour' => '#1e7a4f', 'réglé' => '#2271b1', 'existant' => '#646970', 'ignoré' => '#c4172c'][$status] ?? '#000';
                printf('<tr><td style="width:90px;color:%s;font-weight:600">%s</td><td>%s%s</td></tr>', $color, esc_html($status), esc_html($what), $edit($id));
            }
            echo '</tbody></table>';
        }

        if ($state['done_at']) {
            $todos = CB_Setup::todos();
            echo '<h2>À compléter</h2>';
            if (!$todos) {
                echo '<p>✔ Plus aucun champ « [à compléter] » dans les pages.</p>';
            } else {
                echo '<p>Les passages surlignés en jaune <mark style="background:#FFE58F">[à compléter : …]</mark> attendent vos informations (délais, SIRET, contact…).</p><ul>';
                foreach ($todos as [$id, $title, $n]) {
                    echo '<li><strong>' . esc_html($title) . "</strong> : $n champ" . ($n > 1 ? 's' : '') . $edit($id) . '</li>';
                }
                echo '</ul>';
            }
            $public = (bool) get_option('blog_public');
            $soon = get_option('woocommerce_coming_soon') === 'yes';
            $seo = defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION');
            echo '<h2>Et ensuite</h2><ol style="max-width:760px">';
            echo '<li>Remplacer les illustrations par <strong>vos photos</strong> de jeux imprimés (dans chaque page : cliquer l’image → Remplacer ; pour un produit : Image produit).</li>';
            echo '<li>Vérifier les <strong>prix</strong> des deux jeux (Produits).</li>';
            echo '<li><strong>Paiement</strong> : extension « WooCommerce Stripe Payment Gateway ». <strong>Livraison</strong> : WooCommerce → Réglages → Expédition.</li>';
            echo '<li><strong>Référencement</strong> : ' . ($seo ? '✔ extension SEO active' : 'installer <strong>Rank Math</strong> ou <strong>Yoast SEO</strong> (les titres et descriptions sont déjà prêts, ils seront repris)') . '.</li>';
            echo '<li><strong>Visibilité</strong> : ' . ($public ? '⚠ le site est ouvert aux moteurs de recherche' : '✔ le site est masqué aux moteurs de recherche pendant la construction (Réglages → Lecture)')
                . ($soon ? ' · mode « Bientôt disponible » de WooCommerce actif (visiteurs bloqués, vous voyez le site car vous êtes connecté)' : '') . '.</li>';
            echo '<li>Le jour du lancement, sur le domaine définitif : ouvrir aux moteurs, puis déclarer le site dans <strong>Google Search Console</strong> et <strong>Google Merchant Center</strong>.</li>';
            echo '</ol>';
        }
        echo '</div>';
    }

    /** Boutique : ce qui fait perdre le panier entre deux pages (adresses, cookies, cache). */
    private static function shop_checks(): void
    {
        $home = home_url('/');
        $parts = fn($u) => [(string) wp_parse_url($u, PHP_URL_SCHEME), (string) wp_parse_url($u, PHP_URL_HOST)];
        [$hs, $hh] = $parts($home);
        [$ss, $sh] = $parts(site_url('/'));
        $cart = function_exists('wc_get_cart_url') ? wc_get_cart_url() : '';
        $checkout = function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : '';
        $same = fn($u) => $u && $parts($u) === [$hs, $hh];
        $checkout_id = function_exists('wc_get_page_id') ? wc_get_page_id('checkout') : 0;
        $checkout_post = $checkout_id > 0 ? get_post($checkout_id) : null;
        $has_checkout = $checkout_post && (has_block('woocommerce/checkout', $checkout_post) || has_shortcode($checkout_post->post_content, 'woocommerce_checkout'));
        $plugins = array_merge(array_keys((array) get_site_option('active_sitewide_plugins', [])), (array) get_option('active_plugins', []));
        $caches = array_values(array_filter($plugins, fn($p) => preg_match('/cache|rocket|speed|optimi|litespeed|autoptimize|hummingbird|swift/i', $p)));
        $rows = [
            ['Adresse du site = adresse WordPress', [$hs, $hh] === [$ss, $sh], home_url() . ' · ' . site_url(),
                'Admin du réseau → Sites → carteblanche → Modifier : les deux adresses doivent être identiques (même http/https, même nom).'],
            ['Page vue en ' . (is_ssl() ? 'https' : 'http') . ', site réglé en ' . $hs, (is_ssl() ? 'https' : 'http') === $hs, is_ssl() ? 'https' : 'http',
                $hs === 'https' ? 'Le site est réglé en https mais le certificat ne répond pas : repasser l’adresse en http:// tant que le cadenas n’apparaît pas.' : 'Ouvrir l’admin avec l’adresse du site.'],
            ['Panier sur la même adresse', $same($cart), $cart, 'WooCommerce → Réglages → Avancé : page Panier.'],
            ['Commande sur la même adresse', $same($checkout), $checkout, 'WooCommerce → Réglages → Avancé : page Validation de la commande.'],
            ['Page de commande valide', (bool) $has_checkout, $checkout_post ? $checkout_post->post_title . ' (#' . $checkout_id . ', ' . $checkout_post->post_status . ')' : 'absente',
                'WooCommerce → État → Outils → « Créer les pages par défaut ».'],
            ['Cookies', !defined('COOKIE_DOMAIN') || !COOKIE_DOMAIN || str_ends_with($hh, ltrim((string) COOKIE_DOMAIN, '.')),
                'COOKIE_DOMAIN=' . (defined('COOKIE_DOMAIN') ? var_export(COOKIE_DOMAIN, true) : 'non défini') . ' · COOKIEPATH=' . COOKIEPATH,
                'Dans wp-config.php, COOKIE_DOMAIN ne correspond pas à ce site.'],
            ['Cache de pages', !(defined('WP_CACHE') && WP_CACHE) && !$caches, (defined('WP_CACHE') && WP_CACHE ? 'WP_CACHE actif · ' : '') . ($caches ? implode(', ', $caches) : 'aucune extension de cache'),
                'Exclure du cache les pages Panier, Commande et Mon compte (ou désactiver le cache sur ce site).'],
        ];
        echo '<h2>Boutique : panier et commande</h2><table class="widefat striped" style="max-width:960px"><tbody>';
        foreach ($rows as [$label, $ok, $value, $hint]) {
            printf('<tr><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s</td></tr>', esc_html($label),
                $ok ? '<span style="color:#1e7a4f;font-weight:600">✔ OK</span>' : '<span style="color:#c4172c;font-weight:600">✘ À corriger</span>',
                esc_html($value), $ok ? '' : esc_html($hint));
        }
        echo '</tbody></table>';
        echo '<p style="max-width:960px">Extensions actives : <code>' . esc_html(implode(', ', array_map(fn($p) => dirname($p) === '.' ? $p : dirname($p), $plugins))) . '</code></p>';
    }
}
