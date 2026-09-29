<?php
/**
 * Réglages de l'atelier et catalogue des jeux (repris de services/print-engine/config/products).
 *
 * Un produit WooCommerce « studio » porte une clé de jeu (_cb_deck). Le jeu définit le nombre de
 * cartes, les formats acceptés, la disposition des dos et la grille de prix ; le prix d'une ligne
 * de panier est recalculé par le plugin : (base + cartes × prix par carte + carton) × remise quantité.
 */

defined('ABSPATH') || exit;

final class CB_Settings
{
    public const DEFAULTS = [
        'bleed_mm' => 3.0,
        'dpi' => 350,
        'max_pdf_mb' => 300,
        'segmenter' => 'local', // détourage des visages : fichiers servis par le plugin
    ];

    /** Formats finis (mm). */
    public const FORMATS = [
        'poker' => ['label' => 'Poker 63,5 × 88,9 mm', 'trim' => [63.5, 88.9]],
        'bridge' => ['label' => 'Bridge 57,2 × 88,9 mm', 'trim' => [57.2, 88.9]],
        'tarot' => ['label' => 'Tarot 70 × 120 mm', 'trim' => [70.0, 120.0]],
    ];

    public const MEDIA = [
        'cmdm-350g' => ['label' => 'Couché mat 350 g', 'hint' => 'Rigide et mat, le carton des jeux de qualité'],
        'carte-graphique-300g' => ['label' => 'Carte graphique 300 g', 'hint' => 'Plus souple, toucher naturel'],
    ];

    private const TIERS = [[1, 1.0], [5, 0.85], [10, 0.75], [25, 0.65], [50, 0.55]];

    public static function get(string $key)
    {
        $all = get_option('cb_settings', []);
        return $all[$key] ?? self::DEFAULTS[$key] ?? null;
    }

    /**
     * Jeux proposés.
     * cards : nombre fixe, ou cards_min / cards_max (oracle : le nombre vient du PDF déposé) ;
     * backs : common (page 1 = dos, puis les faces) ou individual (face, dos, face, dos…) ;
     * editor : création en ligne (dos + figures, ou dos + une image par carte pour l'oracle).
     */
    public static function decks(): array
    {
        $media = ['carte-graphique-300g' => -1.50];
        return [
            '54' => ['label' => 'Jeu de 54 cartes poker, dos commun', 'cards' => 54, 'formats' => ['poker'], 'backs' => 'common', 'editor' => true,
                'pricing' => ['unit' => 24.90, 'per_card' => 0.0, 'tiers' => self::TIERS, 'media' => $media]],
            '32' => ['label' => 'Jeu de 32 cartes poker (belote), dos commun', 'cards' => 32, 'formats' => ['poker'], 'backs' => 'common', 'editor' => true,
                'pricing' => ['unit' => 19.90, 'per_card' => 0.0, 'tiers' => self::TIERS, 'media' => $media]],
            '54-bridge' => ['label' => 'Jeu de 54 cartes bridge, dos commun', 'cards' => 54, 'formats' => ['bridge'], 'backs' => 'common', 'editor' => true,
                'pricing' => ['unit' => 24.90, 'per_card' => 0.0, 'tiers' => self::TIERS, 'media' => $media]],
            'oracle' => ['label' => 'Jeu oracle (22 à 100 cartes)', 'cards' => 44, 'cards_min' => 22, 'cards_max' => 100, 'formats' => ['tarot', 'poker'], 'backs' => 'common', 'editor' => true,
                'pricing' => ['unit' => 12.00, 'per_card' => 0.28, 'tiers' => [[1, 1.0], [5, 0.88], [10, 0.78], [25, 0.68], [50, 0.6]], 'media' => ['carte-graphique-300g' => -0.80]]],
        ];
    }

    public static function deck(string $key): ?array
    {
        return self::decks()[$key] ?? null;
    }

    /** Pages attendues dans un PDF pour `cards` cartes. */
    public static function pages_for(array $deck, int $cards): int
    {
        return $deck['backs'] === 'individual' ? 2 * $cards : $cards + 1;
    }

    /** Taille en pixels d'une carte avec fond perdu, à la résolution d'impression. */
    public static function card_px(string $deck = '54', ?string $format = null): array
    {
        $d = self::deck($deck) ?? self::deck('54');
        [$w, $h] = self::FORMATS[$format ?? $d['formats'][0]]['trim'];
        $b = 2 * (float) self::get('bleed_mm');
        $dpi = (int) self::get('dpi');
        return [(int) round(($w + $b) / 25.4 * $dpi), (int) round(($h + $b) / 25.4 * $dpi)];
    }

    /**
     * Prix unitaire TTC d'un jeu, comme le site d'origine (apps/site/src/lib/pricing.ts).
     * @return array{unit:float, discount:int} prix d'un exemplaire, remise en %
     */
    public static function price(string $deck, int $copies = 1, ?int $cards = null, string $media = 'cmdm-350g'): array
    {
        $p = self::deck($deck)['pricing'];
        $d = self::deck($deck);
        $base = $p['unit'] + $p['per_card'] * ($cards ?? $d['cards_min'] ?? $d['cards']) + ($p['media'][$media] ?? 0);
        $coef = 1.0;
        foreach ($p['tiers'] as [$min, $c]) {
            if ($copies >= $min) {
                $coef = $c;
            }
        }
        return ['unit' => round($base * $coef, 2), 'discount' => (int) round((1 - $coef) * 100)];
    }
}
