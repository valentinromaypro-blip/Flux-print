<?php
/**
 * API du studio (namespace cb/v1), utilisée par le navigateur du client.
 *
 * Un visiteur est reconnu par un cookie de session propre au plugin : il ne voit que ses
 * travaux. L'atelier (droit manage_woocommerce) voit tout.
 *
 *   POST /jobs                      {product_id, kind: design|pdf}      → {uid}
 *   POST /jobs/{uid}/file?role=…    corps brut (JPEG, ou PDF par morceaux : &offset=…)
 *   POST /jobs/{uid}/submit         {design}                             → contrôle
 *   GET  /jobs/{uid}                                                     → état, messages, aperçus
 *   GET  /jobs/{uid}/preview/{n}                                         → image d'aperçu
 */

defined('ABSPATH') || exit;

final class CB_Rest
{
    private const COOKIE = 'cb_session';
    private const NS = 'cb/v1';

    public static function init(): void
    {
        add_action('rest_api_init', [self::class, 'routes']);
    }

    public static function routes(): void
    {
        $open = ['permission_callback' => '__return_true'];
        register_rest_route(self::NS, '/jobs', $open + ['methods' => 'POST', 'callback' => [self::class, 'create']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})', $open + ['methods' => 'GET', 'callback' => [self::class, 'show']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/file', $open + ['methods' => 'POST', 'callback' => [self::class, 'file']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/submit', $open + ['methods' => 'POST', 'callback' => [self::class, 'submit']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/box', $open + ['methods' => 'GET', 'callback' => [self::class, 'box']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/box-back', $open + ['methods' => 'GET', 'callback' => [self::class, 'box_back']]);
        register_rest_route(self::NS, '/box-template', $open + ['methods' => 'GET', 'callback' => [self::class, 'box_template']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/pack', $open + ['methods' => 'POST', 'callback' => [self::class, 'pack']]);
        register_rest_route(self::NS, '/jobs/(?P<uid>[a-f0-9]{32})/preview/(?P<n>[a-z0-9-]{1,20})', $open + ['methods' => 'GET', 'callback' => [self::class, 'preview']]);
    }

    /** Session du visiteur (cookie créé à la première requête). */
    public static function session(bool $create = true): ?string
    {
        $value = $_COOKIE[self::COOKIE] ?? '';
        if (preg_match('/^[a-f0-9]{64}$/', $value)) {
            return $value;
        }
        if (!$create) {
            return null;
        }
        $value = bin2hex(random_bytes(32));
        setcookie(self::COOKIE, $value, [
            'expires' => time() + 60 * DAY_IN_SECONDS, 'path' => COOKIEPATH ?: '/', 'secure' => is_ssl(),
            'httponly' => true, 'samesite' => 'Lax',
        ]);
        $_COOKIE[self::COOKIE] = $value;
        return $value;
    }

    /** Le travail, s'il appartient au visiteur (ou si c'est l'atelier). */
    public static function owned(string $uid): ?array
    {
        $job = CB_Store::job($uid);
        if (!$job) {
            return null;
        }
        if (current_user_can('manage_woocommerce') || hash_equals($job['session'], (string) self::session(false))) {
            return $job;
        }
        return null;
    }

    private static function fail(string $message, int $status = 400): WP_Error
    {
        return new WP_Error('cb_error', $message, ['status' => $status]);
    }

    public static function create(WP_REST_Request $r)
    {
        $product_id = (int) $r->get_param('product_id');
        $deck = (string) get_post_meta($product_id, '_cb_deck', true);
        $spec = CB_Settings::deck($deck);
        if (!$spec) {
            return self::fail('Produit inconnu.');
        }
        $kind = $r->get_param('kind') === 'pdf' || !$spec['editor'] ? 'pdf' : 'design';
        $media = (string) $r->get_param('media');
        if (!isset(CB_Settings::MEDIA[$media])) {
            $media = (string) (get_post_meta($product_id, '_cb_media', true) ?: 'cmdm-350g');
        }
        $job = CB_Store::create_job([
            'session' => self::session(), 'product_id' => $product_id, 'kind' => $kind, 'deck' => $deck,
            'media' => $media, 'format' => in_array($r->get_param('format'), $spec['formats'], true) ? $r->get_param('format') : $spec['formats'][0],
            'cards' => $spec['cards_min'] ?? $spec['cards'],
        ]);
        return ['uid' => $job['uid'], 'card_px' => CB_Settings::card_px($deck)];
    }

    public static function file(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        $role = (string) $r->get_param('role');
        $body = $r->get_body();
        // L'étui se crée une fois le jeu validé ; le reste, avant
        $box = in_array($role, ['box', 'boxpdf'], true);
        if (!$job || !in_array($job['status'], $box ? ['approved'] : ['draft', 'rejected'], true)) {
            return self::fail('Création introuvable ou déjà validée.', 404);
        }
        $dir = CB_Store::job_dir($job['uid']);
        if ($box && ($job['pack'] ?? 'film') === 'custom') {
            CB_Store::update_job($job['uid'], ['pack' => 'film']); // nouvel étui : à contrôler à nouveau
        }
        if ($role === 'boxpdf') { // PDF de l'étui fait par le client, par morceaux
            $offset = (int) $r->get_param('offset');
            $path = "$dir/box.pdf";
            if ($offset === 0) {
                @unlink($path);
                @unlink("$dir/cards/box.jpg");
                if (strncmp($body, '%PDF', 4) !== 0) {
                    return self::fail("Ce fichier n'est pas un PDF.");
                }
            }
            $size = file_exists($path) ? filesize($path) : 0;
            if ($offset !== $size) {
                return self::fail("Morceau inattendu (reçu à $offset, attendu à $size).", 409);
            }
            if ($size + strlen($body) > 100 * 1048576) {
                return self::fail('Fichier trop lourd (100 Mo au plus).', 413);
            }
            file_put_contents($path, $body, FILE_APPEND);
            return ['received' => $size + strlen($body)];
        }
        if ($role === 'box') { // étui créé dans le studio : image à plat, 300 dpi
            if (strncmp($body, "\xFF\xD8", 2) !== 0 || strlen($body) > 25 * 1048576) {
                return self::fail('Image invalide.');
            }
            @unlink("$dir/box.pdf");
            wp_mkdir_p("$dir/cards");
            file_put_contents("$dir/cards/box.jpg", $body);
            return ['ok' => true];
        }
        if ($role === 'pdf' && $job['kind'] === 'pdf') {
            $offset = (int) $r->get_param('offset');
            $path = "$dir/source.pdf";
            $size = file_exists($path) ? filesize($path) : 0;
            if ($offset !== $size) {
                return self::fail("Morceau inattendu (reçu à $offset, attendu à $size).", 409);
            }
            if ($size + strlen($body) > CB_Settings::get('max_pdf_mb') * 1048576) {
                return self::fail('Fichier trop lourd.', 413);
            }
            if ($offset === 0 && strncmp($body, '%PDF', 4) !== 0) {
                return self::fail("Ce fichier n'est pas un PDF.");
            }
            file_put_contents($path, $body, FILE_APPEND);
            return ['received' => $size + strlen($body)];
        }
        // Création en ligne : une image JPEG par carte personnalisée, à la taille d'impression
        if (!preg_match('/^(back|court-[SHDC]-[JQK]|card-\d{3})$/', $role)) {
            return self::fail('Fichier inattendu.');
        }
        if (strncmp($body, "\xFF\xD8", 2) !== 0 || strlen($body) > 15 * 1048576) {
            return self::fail('Image invalide.');
        }
        wp_mkdir_p("$dir/cards");
        file_put_contents("$dir/cards/$role.jpg", $body);
        return ['ok' => true];
    }

    public static function submit(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        if (!$job || !in_array($job['status'], ['draft', 'rejected'], true)) {
            return self::fail('Création introuvable ou déjà validée.', 404);
        }
        $design = $r->get_param('design');
        CB_Store::update_job($job['uid'], [
            'status' => 'uploaded', 'design' => is_array($design) ? $design : null, 'error' => null, 'report' => null,
        ]);
        CB_Check::run($job['uid']); // rapide pour une création en ligne ; un PDF est traité en tâche de fond
        return self::show($r);
    }

    public static function show(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        if (!$job) {
            return self::fail('Création introuvable.', 404);
        }
        CB_Check::nudge($job);
        $job = CB_Store::job($job['uid']);
        $report = $job['report'] ?: [];
        $price = CB_Settings::price($job['deck'], 1, $job['cards'] ? (int) $job['cards'] : null, $job['media'], $job['pack'] ?? 'film');
        return [
            'uid' => $job['uid'],
            'status' => $job['status'],
            'pack' => $job['pack'] ?? 'film',
            'cards' => $job['cards'] ? (int) $job['cards'] : null,
            'format' => CB_Settings::FORMATS[$job['format']]['label'] ?? null,
            'price' => $price['unit'],
            'messages' => $report['messages'] ?? [],
            'previews' => array_map(
                fn($n) => rest_url(self::NS . "/jobs/{$job['uid']}/preview/$n"),
                $report['previews'] ?? []
            ),
            'error' => $job['status'] === 'failed' ? 'Le contrôle a échoué. Réessayez ou contactez-nous.' : null,
        ];
    }

    // --- Conditionnement (après validation du jeu) -------------------------------------------------

    /** Ce qu'il faut au studio pour l'étui : conditionnements proposés, gabarit exact, adresses. */
    public static function box(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        if (!$job || $job['status'] !== 'approved') {
            return self::fail('Création introuvable ou non validée.', 404);
        }
        $deck = CB_Settings::deck($job['deck']);
        $g = CB_Box::for_job($job);
        return [
            'pack' => $job['pack'] ?? 'film',
            'packs' => array_map(fn($k) => ['id' => $k, 'label' => CB_Box::PACKS[$k]['label'], 'hint' => CB_Box::PACKS[$k]['hint'], 'price' => CB_Box::price($k)],
                CB_Box::offered($deck, $job['format'])),
            'geometry' => $g, 'px' => CB_Box::px($g),
            'back' => rest_url(self::NS . "/jobs/{$job['uid']}/box-back"),
            'design' => is_array($job['design']) ? array_intersect_key($job['design'], array_flip(['bg', 'ink', 'title', 'subtitle'])) : [],
        ];
    }

    /** Le dos du jeu en pleine définition, pour « reprendre le dos » sur l'étui. */
    public static function box_back(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        if (!$job) {
            return self::fail('Création introuvable.', 404);
        }
        $dir = CB_Store::job_dir($job['uid']);
        $file = "$dir/cards/back.jpg";
        if ($job['kind'] === 'pdf') {
            $file = "$dir/box-back.jpg";
            if (!is_file($file)) {
                $page = CB_Settings::deck($job['deck'])['backs'] === 'individual' ? 2 : 1;
                $pages = CB_Check::render_pages("$dir/source.pdf", "$dir/bb-%03d.jpg", 300, $page, $page);
                if ($pages) {
                    rename($pages[0], $file);
                }
            }
        }
        if (!is_file($file)) {
            return self::fail('Dos introuvable.', 404);
        }
        nocache_headers();
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;
    }

    /** Gabarit PDF de l'étui personnalisé d'un jeu (produit, format, carton, nombre de cartes). */
    public static function box_template(WP_REST_Request $r)
    {
        $product_id = (int) $r->get_param('product_id');
        $deck = CB_Settings::deck((string) get_post_meta($product_id, '_cb_deck', true));
        if (!$deck) {
            return self::fail('Produit inconnu.');
        }
        $format = in_array($r->get_param('format'), $deck['formats'], true) ? (string) $r->get_param('format') : $deck['formats'][0];
        $media = isset(CB_Settings::MEDIA[$r->get_param('media')]) ? (string) $r->get_param('media') : 'cmdm-350g';
        $cards = (int) $r->get_param('cards') ?: ($deck['cards_min'] ?? $deck['cards']);
        $cards = max($deck['cards_min'] ?? $deck['cards'], min($deck['cards_max'] ?? $deck['cards'], $cards));
        $title = get_the_title($product_id) . ' · ' . CB_Settings::FORMATS[$format]['label'] . " · $cards cartes";
        $file = CB_Box::template_pdf(CB_Box::geometry($format, $cards, $media), $title);
        nocache_headers();
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="gabarit-etui-' . $format . '-' . $cards . '-cartes.pdf"');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        @unlink($file);
        exit;
    }

    /** Choix du conditionnement ; pour l'étui personnalisé, contrôle du fichier déposé. */
    public static function pack(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        if (!$job || $job['status'] !== 'approved') {
            return self::fail('Création introuvable ou non validée.', 404);
        }
        $pack = (string) $r->get_param('pack');
        if (!in_array($pack, CB_Box::offered(CB_Settings::deck($job['deck']), $job['format']), true)) {
            return self::fail('Conditionnement indisponible pour ce jeu.');
        }
        $errors = CB_Box::check(['pack' => $pack] + $job);
        if ($errors) {
            return ['ok' => false, 'messages' => $errors];
        }
        CB_Store::update_job($job['uid'], ['pack' => $pack]);
        $job = CB_Store::job($job['uid']);
        $price = CB_Settings::price($job['deck'], 1, $job['cards'] ? (int) $job['cards'] : null, $job['media'], $pack);
        $preview = $pack === 'custom' && is_file(CB_Store::job_dir($job['uid']) . '/preview-box.jpg')
            ? rest_url(self::NS . "/jobs/{$job['uid']}/preview/box") . '?v=' . time() : null;
        return ['ok' => true, 'pack' => $pack, 'price' => $price['unit'], 'preview' => $preview, 'messages' => []];
    }

    public static function preview(WP_REST_Request $r)
    {
        $job = self::owned($r['uid']);
        $path = $job ? CB_Store::job_dir($job['uid']) . '/preview-' . $r['n'] . '.jpg' : '';
        if (!$job || !is_file($path)) {
            return self::fail('Aperçu introuvable.', 404);
        }
        header('Content-Type: image/jpeg');
        header('Cache-Control: private, max-age=3600');
        readfile($path);
        exit;
    }
}
