<?php
/** Thème Carte Blanche : feuille de style, styles de boutons, rien d'autre (tout le reste est dans theme.json). */

defined('ABSPATH') || exit;

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('carte-blanche-theme', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
});

add_action('after_setup_theme', function () {
    add_editor_style('style.css');
    add_theme_support('woocommerce');
});

add_action('init', function () {
    register_block_style('core/button', ['name' => 'red', 'label' => 'Rouge']);
    register_block_style('core/button', ['name' => 'light', 'label' => 'Clair']);
    register_block_style('core/paragraph', ['name' => 'cb-link', 'label' => 'Lien souligné']);
});
