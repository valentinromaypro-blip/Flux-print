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
        $deck = CB_Settings::deck($job['deck']);
        [$w, $h] = CB_Settings::card_px($job['deck'], $job['format']);
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
        // Oracle : une image par carte, numérotées sans trou, dans les limites du jeu
        $free = array_values(array_filter($files, fn($f) => str_contains($f, '/card-')));
        sort($free);
        $cards = $deck['cards'];
        if (isset($deck['cards_min'])) {
            $cards = count($free);
            foreach ($free as $i => $f) {
                if (basename($f) !== sprintf('card-%03d.jpg', $i + 1)) {
                    $errors[] = self::msg('error', 'Une carte manque', 'Validez à nouveau votre jeu.');
                    break;
                }
            }
            if ($cards < $deck['cards_min'] || $cards > $deck['cards_max']) {
                $errors[] = self::msg('error', 'Nombre de cartes incorrect', "$cards carte(s) : de {$deck['cards_min']} à {$deck['cards_max']} cartes.");
            }
        } elseif ($free) { // jeu classique fourni en images, une par carte
            foreach ($free as $i => $f) {
                if (basename($f) !== sprintf('card-%03d.jpg', $i + 1)) {
                    $errors[] = self::msg('error', 'Une carte manque', 'Envoyez à nouveau vos images.');
                    break;
                }
            }
            if (count($free) !== $cards) {
                $errors[] = self::msg('error', 'Nombre d’images incorrect', count($free) . " image(s) de carte reçue(s), $cards attendues, plus le dos.");
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
        $first = $courts[0] ?? $free[0] ?? null;
        if ($first) {
            self::thumb($first, "$dir/preview-court.jpg");
            $previews[] = 'court';
        }
        $n = count($courts);
        // Jeu fourni en images : le jeu entier en vignettes nommées, pour vérifier l'ordre
        $grid = [];
        array_map('unlink', glob("$dir/preview-g*.jpg") ?: []);
        if ($free) {
            $labels = CB_Kit::pages($job['deck'], $cards);
            foreach (["$dir/cards/back.jpg", ...$free] as $i => $src) {
                try {
                    $im = new Imagick($src);
                    $im->thumbnailImage(80, 0);
                    $im->writeImage(sprintf('%s/preview-g%03d.jpg', $dir, $i + 1));
                    $im->clear();
                    $grid[] = $labels[$i] ?? '';
                } catch (Throwable $e) {
                    break;
                }
            }
        }
        $fmt = CB_Settings::FORMATS[$job['format']]['label'] ?? '';
        $detail = isset($deck['cards_min'])
            ? "$cards cartes et le dos en qualité d’impression · $fmt"
            : $cards . ' cartes et le dos en qualité d’impression' . ($n ? " · $n figure" . ($n > 1 ? 's' : '') . ' personnalisée' . ($n > 1 ? 's' : '') : '');
        $messages = [self::msg('ok', 'Votre jeu est prêt à imprimer', $detail)];
        $bl = (float) CB_Settings::get('bleed_mm');
        [$tw, $th] = CB_Settings::FORMATS[$job['format']]['trim'];
        CB_Store::update_job($job['uid'], ['status' => 'approved', 'cards' => $cards, 'report' => ['messages' => $messages, 'previews' => $previews,
            'grid' => $grid, 'trim' => [round($bl / ($tw + 2 * $bl), 4), round($bl / ($th + 2 * $bl), 4)]]]);
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
    /**
     * Comment lire les pages du PDF déposé pour obtenir des cartes au bon format.
     * @return array{0: ?array, 1: string, 2: mixed} [réglage ou null, format, message (correction faite, ou erreur)]
     *   réglage : box ('' | 'bleed' | 'trim'), addbleed (fond perdu à créer), scale (mise à l'échelle)
     */
    private static function fit(string $pdf, string $dir, array $deck, float $b): array
    {
        $size = function (string $box) use ($pdf, $dir) {
            $one = self::render_pages($pdf, "$dir/size-%03d.jpg", 72, 1, 1, $box);
            $s = $one ? getimagesize($one[0]) : null;
            array_map('unlink', $one);
            return $s ? [$s[0] / 72 * 25.4, $s[1] / 72 * 25.4] : null; // mm
        };
        $media = $size('');
        if (!$media) {
            return [null, $deck['formats'][0], 'Page illisible.'];
        }
        $near = fn($a, $c) => abs($a[0] - $c[0]) <= 1.4 && abs($a[1] - $c[1]) <= 1.4;
        $ratio = fn($a, $c) => abs($a[0] / $a[1] - $c[0] / $c[1]) <= 0.005 * ($c[0] / $c[1]); // A4 (1 %) : refusé
        $fmt = fn($v) => str_replace('.', ',', (string) round($v, 1));
        $with = fn($f) => [CB_Settings::FORMATS[$f]['trim'][0] + 2 * $b, CB_Settings::FORMATS[$f]['trim'][1] + 2 * $b];
        $trim = fn($f) => CB_Settings::FORMATS[$f]['trim'];
        foreach ($deck['formats'] as $f) {
            if ($near($media, $with($f))) {
                return [['box' => ''], $f, null];
            }
        }
        $bleed = $size('bleed');
        foreach ($deck['formats'] as $f) {
            if ($bleed && $near($bleed, $with($f))) {
                return [['box' => 'bleed'], $f, ['Traits de coupe retirés', 'Votre PDF contenait des traits de coupe autour des cartes : nous imprimons uniquement la carte et son fond perdu.']];
            }
        }
        $trimbox = $size('trim');
        foreach ($deck['formats'] as $f) {
            foreach (['' => $media, 'trim' => $trimbox] as $box => $s) {
                if ($s && $near($s, $trim($f))) {
                    return [['box' => $box, 'addbleed' => true], $f, ['Fond perdu ajouté automatiquement',
                        "Vos pages font {$fmt($s[0])} × {$fmt($s[1])} mm, sans fond perdu : nous l'avons créé en prolongeant les bords de 3 mm. Vérifiez dans l'aperçu qu'aucun texte ou cadre ne touche le bord ; pour un résultat parfait, utilisez notre gabarit."]];
                }
            }
        }
        foreach ($deck['formats'] as $f) {
            if ($ratio($media, $with($f))) {
                return [['box' => '', 'scale' => true], $f, ['Pages mises à l’échelle',
                    "Vos pages font {$fmt($media[0])} × {$fmt($media[1])} mm, aux bonnes proportions : nous les avons ajustées à {$fmt($with($f)[0])} × {$fmt($with($f)[1])} mm."]];
            }
            if ($ratio($media, $trim($f))) {
                return [['box' => '', 'scale' => true, 'addbleed' => true], $f, ['Pages ajustées et fond perdu ajouté',
                    "Vos pages font {$fmt($media[0])} × {$fmt($media[1])} mm, aux proportions de la carte sans fond perdu : nous les avons ajustées et avons prolongé les bords de 3 mm. Vérifiez qu'aucun élément important ne touche le bord."]];
            }
        }
        $expected = implode(' ou ', array_map(fn($f) => "{$fmt($with($f)[0])} × {$fmt($with($f)[1])} mm", $deck['formats']));
        return [null, $deck['formats'][0], "Pages de {$fmt($media[0])} × {$fmt($media[1])} mm, attendu $expected (fond perdu compris). Téléchargez notre kit de création : le gabarit est au bon format."];
    }

    /** Aperçu « couleurs d'impression » : l'image passée par le profil de la presse, puis ré-affichée. */
    private static function proof(string $src, string $dst): void
    {
        try {
            $im = new Imagick($src);
            $im->profileImage('icc', file_get_contents(CB_DIR . '/assets/icc/sRGB.icc'));
            $im->profileImage('icc', file_get_contents(CB_DIR . '/assets/icc/PSO_Coated_v3.icc'));
            $im->profileImage('icc', file_get_contents(CB_DIR . '/assets/icc/sRGB.icc'));
            $im->transformImageColorspace(Imagick::COLORSPACE_SRGB);
            $im->stripImage();
            $im->setImageFormat('jpeg');
            $im->writeImage($dst);
            $im->clear();
        } catch (Throwable $e) {
            @copy($src, $dst);
        }
    }

    /**
     * Pages d'un PDF en JPEG. $box : zone de page à rendre ('' : la page entière, 'bleed' : la zone
     * de fond perdu, 'trim' : la zone de coupe) — sert quand le PDF contient des traits de coupe.
     */
    public static function render_pages(string $pdf, string $pattern, int $dpi, int $first = 1, ?int $last = null, string $box = ''): array
    {
        $gs = self::gs();
        if (!$gs) {
            throw new RuntimeException('Ghostscript indisponible sur ce serveur.');
        }
        $args = ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=jpeg', '-dJPEGQ=85', "-r$dpi",
                 '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', "-dFirstPage=$first"];
        if ($box !== '') {
            $args[] = $box === 'bleed' ? '-dUseBleedBox' : '-dUseTrimBox';
        }
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
            $n = count($pages);
            $deck = CB_Settings::deck($job['deck']);
            $b = (float) CB_Settings::get('bleed_mm');
            $pt = fn($mm) => $mm / 25.4 * 72;
            $messages = [];
            $order = $deck['backs'] === 'individual'
                ? 'recto verso alternés : face 1, dos 1, face 2, dos 2…'
                : 'le dos en page 1, puis les faces dans l’ordre (pique, cœur, carreau, trèfle ; de l’as au roi ; puis les jokers)';
            // Nombre de cartes : fixe, ou déduit du nombre de pages (oracle)
            if (isset($deck['cards_min'])) {
                $cards = $deck['backs'] === 'individual' ? intdiv($n, 2) : $n - 1;
                $min = CB_Settings::pages_for($deck, $deck['cards_min']);
                $max = CB_Settings::pages_for($deck, $deck['cards_max']);
                if ($n < $min || $n > $max || ($deck['backs'] === 'individual' && $n % 2)) {
                    $messages[] = self::msg('error', 'Nombre de pages incorrect',
                        "$n page(s) reçue(s). De {$deck['cards_min']} à {$deck['cards_max']} cartes, soit $min à $max pages : $order.");
                }
            } else {
                $cards = $deck['cards'];
                $expected = CB_Settings::pages_for($deck, $cards);
                if ($n !== $expected) {
                    $why = $n === $expected - 1 ? ' Il manque une page : souvent le dos, attendu en page 1.'
                        : ($n === $expected + 1 ? ' Une page de trop : page blanche ou page de titre ?' : '');
                    $messages[] = self::msg('error', 'Nombre de pages incorrect', "$n page(s) reçue(s), $expected attendues : $order.$why Comparez avec l’aperçu du jeu ci-dessous.");
                }
            }
            // Format : l'un des formats acceptés, fond perdu compris. Corrections automatiques si
            // possible : traits de coupe (zone de fond perdu du PDF), fond perdu absent (prolongé),
            // format proportionnel (mis à l'échelle) ; refus sinon.
            [$fit, $format, $fix] = self::fit($pdf, $dir, $deck, $b);
            if (!$fit) {
                $messages[] = self::msg('error', 'Format de page incorrect', $fix);
                $format = $deck['formats'][0];
            } elseif ($fix) {
                $messages[] = self::msg('warn', $fix[0], $fix[1]);
            }
            array_map('unlink', $pages);
            $previews = [];
            $box = $fit['box'] ?? '';
            foreach (self::render_pages($pdf, "$dir/pv-%03d.jpg", 150, 1, 2, $box) as $i => $file) {
                $name = ($i === 0) === ($deck['backs'] !== 'individual') ? 'back' : 'court';
                self::thumb($file, "$dir/preview-$name.jpg");
                self::proof("$dir/preview-$name.jpg", "$dir/preview-$name-proof.jpg");
                unlink($file);
                $previews[] = $name;
            }
            // Le jeu entier, en vignettes nommées, pour vérifier l'ordre avant de payer
            array_map('unlink', glob("$dir/preview-g*.jpg") ?: []);
            $grid = [];
            if ($n <= 220) {
                $labels = CB_Kit::pages($job['deck'], $cards);
                foreach (self::render_pages($pdf, "$dir/gr-%03d.jpg", 22, 1, null, $box) as $i => $file) {
                    rename($file, sprintf('%s/preview-g%03d.jpg', $dir, $i + 1));
                    $grid[] = $labels[$i] ?? 'Page en trop';
                }
            }
            $ok = !array_filter($messages, fn($m) => $m['level'] === 'error');
            if ($ok) {
                array_unshift($messages, self::msg('ok', 'Votre fichier est prêt à imprimer',
                    "$cards cartes · " . CB_Settings::FORMATS[$format]['label'] . " · $n pages contrôlées : nombre de pages, format et fond perdu."));
            }
            [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
            $trim = !empty($fit['addbleed']) ? [0, 0] : [round($b / ($tw + 2 * $b), 4), round($b / ($th + 2 * $b), 4)];
            CB_Store::update_job($uid, ['status' => $ok ? 'approved' : 'rejected', 'cards' => $cards, 'format' => $format,
                'design' => ['fit' => $fit ?: null],
                'report' => ['messages' => $messages, 'previews' => $previews, 'grid' => $grid, 'trim' => $trim]]);
        } catch (Throwable $e) {
            CB_Store::update_job($uid, ['status' => 'failed', 'error' => $e->getMessage(),
                'report' => ['messages' => [self::msg('error', 'Lecture du PDF impossible', 'Le fichier est peut-être protégé ou endommagé. Exportez-le à nouveau en PDF.')]]]);
        }
    }
}
