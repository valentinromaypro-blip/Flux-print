<?php
/** Commandes WP-CLI : `wp carte-blanche demo` crée les produits de démonstration. */

defined('ABSPATH') || exit;

WP_CLI::add_command('carte-blanche', new class {
    /** Mise en place du site : pages, produits, menus, réglages (comme le bouton de l'administration). */
    public function setup(): void
    {
        foreach (CB_Setup::run() as [$status, $what]) {
            WP_CLI::log(str_pad($status, 10) . $what);
        }
        WP_CLI::success('Site mis en place : ' . home_url('/'));
    }

    /** Ancien nom de la commande. */
    public function demo(): void
    {
        $this->setup();
    }
});
