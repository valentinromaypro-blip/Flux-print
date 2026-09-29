<?php
/** Administration : menu « Carte Blanche » (diagnostic de l'hébergement, puis atelier). */

defined('ABSPATH') || exit;

final class CB_Admin
{
    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'menu']);
    }

    public static function menu(): void
    {
        add_menu_page('Carte Blanche', 'Carte Blanche', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic'], 'dashicons-images-alt2', 56);
        add_submenu_page('carte-blanche', 'Diagnostic', 'Diagnostic', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic']);
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
        $products = get_posts(['post_type' => 'product', 'meta_key' => '_cb_deck', 'meta_compare' => '!=', 'meta_value' => '', 'numberposts' => 20]);
        echo '<h2>Produits avec le studio</h2>';
        if (!$products) {
            echo '<p>Aucun pour l’instant : ouvrez un produit WooCommerce → onglet Général → « Studio Carte Blanche ».</p>';
        } else {
            echo '<ul>' . implode('', array_map(fn($p) => '<li><a href="' . esc_url(get_permalink($p)) . '">' . esc_html($p->post_title) . '</a></li>', $products)) . '</ul>';
        }
        echo '</div>';
    }
}
