<?php
/**
 * Contrôle d'une création avant l'ajout au panier.
 *
 * - Création en ligne : le navigateur envoie les cartes personnalisées (dos, figures avec
 *   visage) à la taille d'impression ; on vérifie format et dimensions, puis on fait les aperçus.
 * - PDF déposé : nombre de pages, format avec fond perdu, aperçus. Le rendu passe par
 *   Ghostscript (présent chez OVH, appelé comme programme externe, sans être modifié).
 *   Traité en tâche de fond (Action Scheduler de WooCommerce), le navigateur interroge l'état.
 */

defined('ABSPATH') || exit;

final class CB_Check
{
    public static function init(): void
    {
        add_action('cb_check_pdf', [self::class, 'check_pdf']);
    }

    public static function run(string $uid): void
    {
        $job = CB_Store::job($uid);
        if (!$job) {
            return;
        }
        if ($job['kind'] === 'pdf') {
            CB_Store::update_job($uid, ['status' => 'checking']);
            if (function_exists('as_enqueue_async_action')) {
                as_enqueue_async_action('cb_check_pdf', [$uid], 'carte-blanche');
            } else {
                self::check_pdf($uid);
            }
            return;
        }
        try {
            self::check_design($job);
        } catch (Throwable $e) {
            CB_Store::update_job($uid, ['status' => 'failed', 'error' => $e->getMessage()]);
        }
    }

    private static function msg(string $level, string $title, string $help = ''): array
    {
        return ['level' => $level, 'title' => $title, 'help' => $help, 'cards' => []];
    }

    private static function check_design(array $job): void
    {
        $dir = CB_Store::job_dir($job['uid']);
        [$w, $h] = CB_Settings::card_px($job['deck']);
        $files = glob("$dir/cards/*.jpg") ?: [];
        $errors = [];
        if (!is_file("$dir/cards/back.jpg")) {
            $errors[] = self::msg('error', 'Le dos est manquant', 'Revenez à l’étape « Le dos » puis validez à nouveau.');
        }
        foreach ($files as $file) {
            $size = @getimagesize($file);
            if (!$size || $size[2] !== IMAGETYPE_JPEG || $size[0] !== $w || $size[1] !== $h) {
                $errors[] = self::msg('error', 'Une carte n’a pas été préparée correctement', basename($file, '.jpg'));
            }
        }
        if ($errors) {
            CB_Store::update_job($job['uid'], ['status' => 'rejected', 'report' => ['messages' => $errors, 'previews' => []]]);
            return;
        }
        $previews = [];
        self::thumb("$dir/cards/back.jpg", "$dir/preview-back.jpg");
        $previews[] = 'back';
        $courts = array_values(array_filter($files, fn($f) => str_contains($f, '/court-')));
        if ($courts) {
            self::thumb($courts[0], "$dir/preview-court.jpg");
            $previews[] = 'court';
        }
        $n = count($courts);
        $messages = [self::msg('ok', 'Votre jeu est prêt à imprimer',
            CB_Settings::decks()[$job['deck']]['cards'] + 1 . ' cartes en qualité d’impression' . ($n ? " · $n figure" . ($n > 1 ? 's' : '') . ' personnalisée' . ($n > 1 ? 's' : '') : ''))];
        CB_Store::update_job($job['uid'], ['status' => 'approved', 'report' => ['messages' => $messages, 'previews' => $previews]]);
    }

    /** Vignette JPEG (600 px de large) d'une image. */
    private static function thumb(string $src, string $dest, int $width = 600): void
    {
        $img = wp_get_image_editor($src);
        if (is_wp_error($img)) {
            copy($src, $dest);
            return;
        }
        $img->resize($width, null);
        $img->set_quality(85);
        $img->save($dest, 'image/jpeg');
    }

    /** Ghostscript, s'il est utilisable (exec autorisé). */
    public static function gs(): ?string
    {
        static $bin = false;
        if ($bin !== false) {
            return $bin;
        }
        $bin = null;
        if (function_exists('exec') && !in_array('exec', array_map('trim', explode(',', (string) ini_get('disable_functions'))), true)) {
            foreach (['gs', '/usr/bin/gs', '/usr/local/bin/gs'] as $candidate) {
                $out = [];
                @exec(escapeshellarg($candidate) . ' --version 2>/dev/null', $out, $code);
                if ($code === 0 && $out) {
                    $bin = $candidate;
                    break;
                }
            }
        }
        return $bin;
    }

    /** Rend des pages PDF en JPEG avec Ghostscript. Renvoie les fichiers produits. */
    public static function render_pages(string $pdf, string $pattern, int $dpi, int $first = 1, ?int $last = null): array
    {
        $gs = self::gs();
        if (!$gs) {
            throw new RuntimeException('Ghostscript indisponible sur ce serveur.');
        }
        $args = ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=jpeg', '-dJPEGQ=85', "-r$dpi",
                 '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', "-dFirstPage=$first"];
        if ($last) {
            $args[] = "-dLastPage=$last";
        }
        $cmd = escapeshellarg($gs) . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' -sOutputFile=' .
            escapeshellarg($pattern) . ' ' . escapeshellarg($pdf) . ' 2>&1';
        exec($cmd, $out, $code);
        if ($code !== 0) {
            throw new RuntimeException('Lecture du PDF impossible : ' . implode(' ', array_slice($out, 0, 3)));
        }
        return glob(str_replace('%03d', '*', $pattern)) ?: [];
    }

    /**
     * Filet de sécurité : si la tâche de fond n'a pas démarré (WP-Cron ou appel en boucle locale
     * bloqués sur certains hébergements), l'interrogation du navigateur lance le contrôle elle-même.
     */
    public static function nudge(array $job): void
    {
        if ($job['kind'] === 'pdf' && $job['status'] === 'checking' && time() - strtotime($job['updated_at'] . ' UTC') > 15) {
            @set_time_limit(160);
            self::check_pdf($job['uid']);
        }
    }

    public static function check_pdf(string $uid): void
    {
        $job = CB_Store::job($uid);
        // Un seul contrôle à la fois pour un même fichier (tâche de fond et filet de sécurité)
        if (!$job || $job['status'] !== 'checking' || !add_option("cb_lock_$uid", time(), '', false)) {
            if ($job && ($since = (int) get_option("cb_lock_$uid")) && time() - $since > 300) {
                delete_option("cb_lock_$uid"); // verrou abandonné (délai dépassé)
            }
            return;
        }
        try {
            self::check_pdf_locked($job);
        } finally {
            delete_option("cb_lock_$uid");
        }
    }

    private static function check_pdf_locked(array $job): void
    {
        $uid = $job['uid'];
        $dir = CB_Store::job_dir($uid);
        $pdf = "$dir/source.pdf";
        try {
            // Pages à 72 dpi : 1 pixel = 1 point, le format se lit directement
            array_map('unlink', glob("$dir/probe-*.jpg") ?: []);
            $pages = self::render_pages($pdf, "$dir/probe-%03d.jpg", 12);
            $deck = CB_Settings::decks()[$job['deck']];
            $expected_pages = $deck['cards'] + 1;
            [$tw, $th] = $deck['trim'];
            $b = (float) CB_Settings::get('bleed_mm');
            $pt = fn($mm) => $mm / 25.4 * 72;
            $messages = [];
            if (count($pages) !== $expected_pages) {
                $messages[] = self::msg('error', 'Nombre de pages incorrect',
                    count($pages) . " page(s) reçue(s), $expected_pages attendues : le dos en page 1, puis les {$deck['cards']} faces dans l’ordre du gabarit.");
            }
            $one = self::render_pages($pdf, "$dir/size-%03d.jpg", 72, 1, 1);
            $size = $one ? getimagesize($one[0]) : null;
            array_map('unlink', $one);
            if ($size) {
                [$pw, $ph] = $size;
                $near = fn($a, $b) => abs($a - $b) <= 4; // ± 1,4 mm
                if ($near($pw, $pt($tw)) && $near($ph, $pt($th))) {
                    $messages[] = self::msg('error', 'Fond perdu manquant',
                        "Vos pages font {$tw} × {$th} mm : ajoutez 3 mm de fond perdu de chaque côté (" . ($tw + 2 * $b) . ' × ' . ($th + 2 * $b) . ' mm). Utilisez notre gabarit.');
                } elseif (!$near($pw, $pt($tw + 2 * $b)) || !$near($ph, $pt($th + 2 * $b))) {
                    $messages[] = self::msg('error', 'Format de page incorrect',
                        sprintf('Pages de %.1f × %.1f mm, attendu %.1f × %.1f mm (fond perdu compris).', $pw / 72 * 25.4, $ph / 72 * 25.4, $tw + 2 * $b, $th + 2 * $b));
                }
            }
            array_map('unlink', $pages);
            $previews = [];
            foreach (self::render_pages($pdf, "$dir/pv-%03d.jpg", 150, 1, 2) as $i => $file) {
                $name = $i === 0 ? 'back' : 'court';
                self::thumb($file, "$dir/preview-$name.jpg");
                unlink($file);
                $previews[] = $name;
            }
            $ok = !array_filter($messages, fn($m) => $m['level'] === 'error');
            if ($ok) {
                array_unshift($messages, self::msg('ok', 'Votre fichier est prêt à imprimer', "$expected_pages pages contrôlées : nombre de pages, format et fond perdu."));
            }
            CB_Store::update_job($uid, ['status' => $ok ? 'approved' : 'rejected', 'report' => ['messages' => $messages, 'previews' => $previews]]);
        } catch (Throwable $e) {
            CB_Store::update_job($uid, ['status' => 'failed', 'error' => $e->getMessage(),
                'report' => ['messages' => [self::msg('error', 'Lecture du PDF impossible', 'Le fichier est peut-être protégé ou endommagé. Exportez-le à nouveau en PDF.')]]]);
        }
    }
}
