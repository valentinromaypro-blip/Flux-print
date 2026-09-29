<?php
/**
 * Plugin Name: Carte Blanche — jeux de cartes personnalisés
 * Description: Studio de création (dos, figures avec visages), contrôle des fichiers, amalgame « pile = jeu » et lots SRA3 prêts pour la presse, intégrés à WooCommerce.
 * Version: 0.2.0
 * Requires PHP: 8.1
 * Requires Plugins: woocommerce
 * Author: Carte Blanche
 * License: GPL-2.0-or-later
 * Text Domain: carte-blanche
 */

defined('ABSPATH') || exit;

define('CB_VERSION', '0.2.0');
define('CB_FILE', __FILE__);
define('CB_DIR', __DIR__);
define('CB_URL', plugin_dir_url(__FILE__));

require_once CB_DIR . '/includes/class-store.php';
require_once CB_DIR . '/includes/class-settings.php';
require_once CB_DIR . '/engine/class-check.php';
require_once CB_DIR . '/includes/class-rest.php';
require_once CB_DIR . '/includes/class-blocks.php';
require_once CB_DIR . '/includes/class-setup.php';
// En cours de développement : les modules pas encore livrés sont ignorés.
foreach (['/includes/class-woo.php', '/admin/class-admin.php'] as $cb_module) {
    if (is_file(CB_DIR . $cb_module)) {
        require_once CB_DIR . $cb_module;
    }
}
if (defined('WP_CLI') && WP_CLI && is_file(CB_DIR . '/includes/class-cli.php')) {
    require_once CB_DIR . '/includes/class-cli.php';
}

register_activation_hook(__FILE__, ['CB_Store', 'install']);

add_action('plugins_loaded', function () {
    if (get_option('cb_db_version') !== CB_VERSION) {
        CB_Store::install();
    }
    CB_Rest::init();
    CB_Check::init();
    CB_Setup::init();
    foreach (['CB_Woo', 'CB_Admin'] as $cb_class) {
        if (class_exists($cb_class)) {
            $cb_class::init();
        }
    }
});
