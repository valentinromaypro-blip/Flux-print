<?php
/** Réglages de l'atelier (Réglages → Carte Blanche), avec des valeurs par défaut sûres. */

defined('ABSPATH') || exit;

final class CB_Settings
{
    public const DEFAULTS = [
        'bleed_mm' => 3.0,
        'dpi' => 350,
        'max_pdf_mb' => 300,
        'segmenter' => 'local', // détourage des visages : fichiers servis par le plugin
    ];

    public static function get(string $key)
    {
        $all = get_option('cb_settings', []);
        return $all[$key] ?? self::DEFAULTS[$key] ?? null;
    }

    /** Jeux proposés : code, nombre de cartes, format fini (mm). */
    public static function decks(): array
    {
        return [
            '54' => ['label' => 'Jeu de 54 cartes (poker)', 'cards' => 54, 'trim' => [63.5, 88.9]],
            '32' => ['label' => 'Jeu de 32 cartes (belote)', 'cards' => 32, 'trim' => [63.5, 88.9]],
        ];
    }

    /** Taille en pixels d'une carte avec fond perdu, à la résolution d'impression. */
    public static function card_px(string $deck = '54'): array
    {
        [$w, $h] = self::decks()[$deck]['trim'];
        $b = 2 * (float) self::get('bleed_mm');
        $dpi = (int) self::get('dpi');
        return [(int) round(($w + $b) / 25.4 * $dpi), (int) round(($h + $b) / 25.4 * $dpi)];
    }
}
