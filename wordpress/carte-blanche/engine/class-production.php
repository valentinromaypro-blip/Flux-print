<?php
/**
 * Production : du jeu payé au PDF d'impression SRA3, sans intervention.
 *
 * 1. Préparation (à la confirmation du paiement) : chaque carte du jeu devient un JPEG CMJN
 *    (PSO Coated v3 / FOGRA51) à 350 dpi, fond perdu compris : faces personnalisées du studio,
 *    faces standard du jeu classique, ou pages du PDF déposé (rendues par Ghostscript).
 * 2. Amalgame : les jeux prêts du même format et du même carton partent ensemble,
 *    aux créneaux presse (11 h et 16 h, heure de Paris) s'il y en a au moins 6, tout de suite
 *    si un livre est plein (18 jeux en poker), et dans tous les cas au bout de 48 h.
 * 3. Imposition « pile = jeu » (reprise du moteur d'origine, services/print-engine) : la feuille n
 *    porte la carte n de chaque jeu ; après une coupe du livre au massicot, chaque pile est un jeu
 *    complet et trié, sa carte d'identification sur le dessus. Recto verso, retournement petit côté.
 *
 * Tout tourne en tâches de fond (Action Scheduler), découpées pour tenir dans les limites d'un
 * hébergement mutualisé ; la page Production de l'admin permet aussi de lancer à la main.
 */

defined('ABSPATH') || exit;

final class CB_Production
{
    public const SHEET = ['code' => 'SRA3', 'w' => 320.0, 'h' => 450.0, 'margin' => 10.0];
    public const RULES = ['launch_times' => ['11:00', '16:00'], 'slot_min_decks' => 6, 'max_wait_hours' => 48];
    private const MARK_LENGTH = 4.0;
    private const MARK_OFFSET = 1.5;
    private const DPI = 350;
    private const BUDGET = 90; // secondes de travail par tâche (OVH : 165 s maximum)

    public static function init(): void
    {
        add_action('cb_prepare_job', [self::class, 'prepare_job']);
        add_action('cb_plan_lots', [self::class, 'plan_lots']);
        add_action('cb_build_lot', [self::class, 'build_lot']);
        add_action('init', [self::class, 'schedule']);
    }

    /** Planification régulière de l'amalgame (toutes les 15 minutes). */
    public static function schedule(): void
    {
        if (function_exists('as_has_scheduled_action') && !as_has_scheduled_action('cb_plan_lots', [], 'carte-blanche')) {
            as_schedule_recurring_action(time() + 60, 15 * MINUTE_IN_SECONDS, 'cb_plan_lots', [], 'carte-blanche');
        }
    }

    private static function enqueue(string $hook, array $args): void
    {
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action($hook, $args, 'carte-blanche');
        } else {
            do_action($hook, ...$args);
        }
    }

    /** Appelé quand la commande est payée. */
    public static function job_paid(string $uid): void
    {
        self::enqueue('cb_prepare_job', [$uid]);
    }

    // --- Géométrie ------------------------------------------------------------------------------

    /** Cartes d'un jeu, dans l'ordre : pique, cœur, carreau, trèfle ; as → roi ; puis les jokers. */
    public static function codes(string $deck): array
    {
        $ranks = $deck === '32' ? ['A', '7', '8', '9', '10', 'J', 'Q', 'K'] : ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        $codes = [];
        foreach (['S', 'H', 'D', 'C'] as $s) {
            foreach ($ranks as $r) {
                $codes[] = "$s-$r";
            }
        }
        return $deck === '32' ? $codes : [...$codes, 'JK-1', 'JK-2'];
    }

    /**
     * Grille de pose maximale sur la feuille (compute_layout du moteur d'origine) : pièces fond
     * perdu contre fond perdu, centrées ; à nombre égal, cartes droites plutôt que pivotées.
     * @return array{cols:int, rows:int, rotation:int, slots:array<int, array{x:float,y:float,w:float,h:float,rot:int,bleed:float}>}
     */
    public static function layout(float $tw, float $th, float $bleed): array
    {
        $s = self::SHEET;
        $aw = $s['w'] - 2 * $s['margin'];
        $ah = $s['h'] - 2 * $s['margin'];
        $best = null;
        foreach ([0, 90] as $rot) {
            [$w, $h] = $rot ? [$th, $tw] : [$tw, $th];
            $sw = $w + 2 * $bleed;
            $sh = $h + 2 * $bleed;
            $cols = (int) floor($aw / $sw);
            $rows = (int) floor($ah / $sh);
            if (!$best || $cols * $rows > $best[0]) {
                $best = [$cols * $rows, $rot, $cols, $rows, $sw, $sh];
            }
        }
        [, $rot, $cols, $rows, $sw, $sh] = $best;
        $x0 = ($s['w'] - $cols * $sw) / 2;
        $ytop = ($s['h'] + $rows * $sh) / 2;
        $slots = [];
        for ($r = 0; $r < $rows; $r++) {
            for ($c = 0; $c < $cols; $c++) {
                $slots[] = ['x' => CB_Pdf::mm($x0 + $c * $sw), 'y' => CB_Pdf::mm($ytop - ($r + 1) * $sh), 'w' => CB_Pdf::mm($sw), 'h' => CB_Pdf::mm($sh),
                    'rot' => $rot, 'bleed' => CB_Pdf::mm($bleed)];
            }
        }
        return ['cols' => $cols, 'rows' => $rows, 'rotation' => $rot, 'slots' => $slots];
    }

    /** La même pose vue au verso : retournement petit côté (presse de l'atelier). */
    private static function verso(array $slot): array
    {
        $H = CB_Pdf::mm(self::SHEET['h']);
        return ['y' => $H - $slot['y'] - $slot['h'], 'rot' => (180 - $slot['rot'] + 360) % 360] + $slot;
    }

    private static function page_px(string $format): array
    {
        [$w, $h] = CB_Settings::FORMATS[$format]['trim'];
        $b = 2 * (float) CB_Settings::get('bleed_mm');
        return [(int) round(($w + $b) / 25.4 * self::DPI), (int) round(($h + $b) / 25.4 * self::DPI)];
    }

    // --- 1. Préparation --------------------------------------------------------------------------

    /** Sources des cartes d'un jeu : [clé => [type, valeur]], type file | front | pdf. */
    private static function sources(array $job): array
    {
        $dir = CB_Store::job_dir($job['uid']);
        $deck = CB_Settings::deck($job['deck']);
        $src = [];
        if ($job['kind'] === 'pdf') {
            $cards = (int) ($job['cards'] ?: $deck['cards']);
            if ($deck['backs'] === 'individual') {
                for ($i = 1; $i <= $cards; $i++) {
                    $src[sprintf('f%03d', $i)] = ['pdf', 2 * $i - 1];
                    $src[sprintf('b%03d', $i)] = ['pdf', 2 * $i];
                }
            } else {
                $src['back'] = ['pdf', 1];
                for ($i = 1; $i <= $cards; $i++) {
                    $src[sprintf('f%03d', $i)] = ['pdf', $i + 1];
                }
            }
            return $src;
        }
        $src['back'] = ['file', "$dir/cards/back.jpg"];
        if (isset($deck['cards_min'])) { // oracle : une image par carte
            foreach (glob("$dir/cards/card-*.jpg") ?: [] as $i => $file) {
                $src[sprintf('f%03d', $i + 1)] = ['file', $file];
            }
            return $src;
        }
        foreach (self::codes($job['deck']) as $i => $code) {
            $drawn = array_filter(["$dir/cards/court-$code.jpg", "$dir/cards/front-$code.jpg"], 'is_file');
            $src[sprintf('f%03d', $i + 1)] = $drawn ? ['file', reset($drawn)] : ['front', $code];
        }
        return $src;
    }

    /** Conversion d'une carte en JPEG CMJN (PSO Coated v3) à la taille d'impression exacte. */
    /**
     * Modèle vintage : encres passées sur papier crème. Même calcul que le studio (cardrender.ts,
     * vintage) : saturation × 0,45 autour de la luminance, puis teinte du papier en multiplication.
     */
    public const VINTAGE = ['sat' => 0.45, 'paper' => [243, 232, 208]];

    private static function vintage(Imagick $im): void
    {
        $s = self::VINTAGE['sat'];
        $w = [0.299, 0.587, 0.114];
        $m = array_fill(0, 25, 0.0);
        for ($i = 0; $i < 3; $i++) {
            for ($j = 0; $j < 3; $j++) {
                $m[5 * $i + $j] = self::VINTAGE['paper'][$i] / 255 * ((1 - $s) * $w[$j] + ($i === $j ? $s : 0));
            }
        }
        $m[18] = $m[24] = 1.0; // noir et opacité inchangés
        $im->colorMatrixImage($m);
    }

    /** Modèle de recto d'une création en ligne ('classique' par défaut). */
    public static function recto(array $job): string
    {
        $r = is_array($job['design'] ?? null) ? (string) ($job['design']['recto'] ?? '') : '';
        return in_array($r, ['classique', 'moderne', 'portrait', 'vintage'], true) ? $r : 'classique';
    }

    private static function to_cmyk(string $src, string $dst, array $px, ?array $fit = null, bool $vintage = false): void
    {
        $im = new Imagick();
        $im->setResolution(self::DPI, self::DPI);
        $im->readImage($src);
        $im->setImageBackgroundColor('white');
        if ($im->getImageAlphaChannel()) {
            $im = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        }
        if ($fit) { // face standard (dessinée au format poker) calée sur la largeur d'un autre format
            [$tw, $th] = $fit;
            $w = $im->getImageWidth();
            $h = $im->getImageHeight();
            $pw = (int) round(63.5 / 25.4 * self::DPI);
            $ph = (int) round(88.9 / 25.4 * self::DPI);
            $im->cropImage($pw, $ph, intdiv($w - $pw, 2), intdiv($h - $ph, 2));
            $im->setImagePage(0, 0, 0, 0);
            $nh = (int) min($th, round($tw * $ph / $pw));
            $im->resizeImage($tw, $nh, Imagick::FILTER_LANCZOS, 1);
            $im->extentImage($px[0], $px[1], -intdiv($px[0] - $tw, 2), -intdiv($px[1] - $nh, 2));
        } elseif ($im->getImageWidth() !== $px[0] || $im->getImageHeight() !== $px[1]) {
            $im->resizeImage($px[0], $px[1], Imagick::FILTER_LANCZOS, 1);
        }
        if ($vintage) {
            self::vintage($im);
        }
        if ($im->getImageColorspace() !== Imagick::COLORSPACE_CMYK) {
            if (!array_key_exists('icc', $im->getImageProfiles('icc', false) ?: [])) {
                $im->profileImage('icc', file_get_contents(CB_DIR . '/assets/icc/sRGB.icc'));
            }
            $im->profileImage('icc', file_get_contents(CB_DIR . '/assets/icc/PSO_Coated_v3.icc'));
            if ($im->getImageColorspace() !== Imagick::COLORSPACE_CMYK) {
                $im->transformImageColorspace(Imagick::COLORSPACE_CMYK);
            }
        }
        $im->stripImage();
        $im->setImageUnits(Imagick::RESOLUTION_PIXELSPERINCH);
        $im->setImageResolution(self::DPI, self::DPI);
        $im->setImageFormat('jpeg');
        $im->setImageCompressionQuality(90);
        $im->writeImage($dst);
        $im->clear();
    }

    /** Face standard d'un format, convertie une fois pour toutes (partagée par tous les jeux). */
    private static function standard_front(string $code, string $format, string $recto = 'classique'): string
    {
        $vintage = $recto === 'vintage';
        $dst = CB_Store::dir('fronts/' . $format . ($vintage ? '-vintage' : '')) . "/$code.jpg";
        if (!is_file($dst)) {
            [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
            $fit = $format === 'poker' ? null : [(int) round($tw / 25.4 * self::DPI), (int) round($th / 25.4 * self::DPI)];
            self::to_cmyk(CB_DIR . "/engine/fronts/$code.jpg", $dst, self::page_px($format), $fit, $vintage);
        }
        return $dst;
    }

    /** Prépare un jeu payé ; reprend là où il s'est arrêté si le temps imparti est écoulé. */
    public static function prepare_job(string $uid, int $budget = self::BUDGET): bool
    {
        $job = CB_Store::job($uid);
        if (!$job || !in_array($job['status'], ['paid', 'preparing'], true)) {
            return true;
        }
        $start = microtime(true);
        @set_time_limit($budget + 60);
        CB_Store::update_job($uid, ['status' => 'preparing', 'error' => null]);
        try {
            $dir = CB_Store::job_dir($uid);
            $out = CB_Store::dir('jobs/' . $uid . '/print');
            $px = self::page_px($job['format']);
            $files = [];
            foreach (self::sources($job) as $key => [$type, $value]) {
                if ($type === 'front') {
                    $files[$key] = self::standard_front($value, $job['format'], self::recto($job));
                    continue;
                }
                $dst = "$out/$key.jpg";
                if (!is_file($dst)) {
                    if (microtime(true) - $start > $budget) { // la suite dans une nouvelle tâche
                        self::enqueue('cb_prepare_job', [$uid]);
                        return false;
                    }
                    $file = $type === 'pdf' ? self::pdf_page($job, (int) $value) : $value;
                    if (!is_file($file)) {
                        throw new RuntimeException("Fichier manquant ($key).");
                    }
                    self::to_cmyk($file, $dst, $px);
                }
                $files[$key] = $dst;
            }
            $fronts = array_values(array_filter($files, fn($k) => $k[0] === 'f', ARRAY_FILTER_USE_KEY));
            $backs = isset($files['back']) ? $files['back'] : array_values(array_filter($files, fn($k) => $k[0] === 'b', ARRAY_FILTER_USE_KEY));
            $base = CB_Store::dir('');
            $rel = fn($p) => ltrim(substr($p, strlen($base)), '/');
            file_put_contents("$out/print.json", wp_json_encode([
                'format' => $job['format'], 'fronts' => array_map($rel, $fronts), 'backs' => is_array($backs) ? array_map($rel, $backs) : $rel($backs),
            ]));
            array_map('unlink', glob("$dir/pdfpages/*.jpg") ?: []);
            CB_Store::update_job($uid, ['status' => 'ready']);
            CB_Store::note((int) $job['order_id'], 'Carte Blanche : fichiers d’impression prêts (' . count($fronts) . ' cartes, CMJN PSO Coated v3).');
            return true;
        } catch (Throwable $e) {
            CB_Store::update_job($uid, ['status' => 'failed', 'error' => 'Préparation : ' . $e->getMessage()]);
            return true;
        }
    }

    /** Page d'un PDF déposé, rendue à 350 dpi par Ghostscript (par paquets de 10 pages). */
    private static function pdf_page(array $job, int $page): string
    {
        $dir = CB_Store::job_dir($job['uid']);
        $pages = CB_Store::dir('jobs/' . $job['uid'] . '/pdfpages');
        $file = sprintf('%s/p%03d.jpg', $pages, $page);
        if (!is_file($file)) {
            $rendered = CB_Check::render_pages("$dir/source.pdf", "$pages/tmp-%03d.jpg", self::DPI, $page, $page + 9);
            sort($rendered);
            foreach ($rendered as $i => $tmp) {
                rename($tmp, sprintf('%s/p%03d.jpg', $pages, $page + $i));
            }
        }
        return $file;
    }

    // --- 2. Amalgame ----------------------------------------------------------------------------

    private static function per_sheet(string $format): int
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        return count(self::layout($tw, $th, (float) CB_Settings::get('bleed_mm'))['slots']);
    }

    /** Jeux prêts, en attente de lot, regroupés par format et carton (les plus anciens d'abord). */
    public static function waiting(): array
    {
        $groups = [];
        foreach (CB_Store::jobs_where("status = 'ready' AND (lot_id IS NULL OR lot_id = '') ORDER BY paid_at ASC, id ASC") as $job) {
            $key = $job['format'] . '|' . $job['media'];
            $groups[$key] ??= ['format' => $job['format'], 'media' => $job['media'], 'jobs' => [], 'decks' => 0, 'oldest' => $job['paid_at']];
            $groups[$key]['jobs'][] = $job;
            $groups[$key]['decks'] += max(1, (int) $job['copies']);
        }
        foreach ($groups as &$g) {
            $g['per_sheet'] = self::per_sheet($g['format']);
            $g['wait_hours'] = $g['oldest'] ? (time() - strtotime($g['oldest'] . ' UTC')) / 3600 : 0;
        }
        return $groups;
    }

    /** Dernier créneau presse passé (heure de Paris). */
    private static function last_slot(): string
    {
        $tz = new DateTimeZone('Europe/Paris');
        $now = new DateTimeImmutable('now', $tz);
        $best = null;
        foreach ([$now, $now->modify('-1 day')] as $day) {
            foreach (self::RULES['launch_times'] as $t) {
                $slot = new DateTimeImmutable($day->format('Y-m-d') . " $t", $tz);
                if ($slot <= $now && (!$best || $slot > $best)) {
                    $best = $slot;
                }
            }
        }
        return $best->format('Y-m-d H:i');
    }

    /** Règles de lancement ; $force : clé de groupe à lancer tout de suite (bouton de l'atelier). */
    public static function plan_lots(?string $force = null): array
    {
        $slot = self::last_slot();
        $at_slot = get_option('cb_last_slot') !== $slot;
        $created = [];
        foreach (self::waiting() as $key => $g) {
            $take = [];
            $reason = '';
            if ($force === $key) {
                [$take, $reason] = [$g['jobs'], 'lancé depuis l’atelier'];
            } elseif ($g['wait_hours'] >= self::RULES['max_wait_hours']) {
                [$take, $reason] = [$g['jobs'], 'délai de 48 h atteint'];
            } elseif ($at_slot && $g['decks'] >= self::RULES['slot_min_decks']) {
                [$take, $reason] = [$g['jobs'], "créneau de $slot"];
            } elseif ($g['decks'] >= $g['per_sheet']) { // livre(s) plein(s) : part sans attendre
                $room = intdiv($g['decks'], $g['per_sheet']) * $g['per_sheet'];
                foreach ($g['jobs'] as $job) {
                    $n = max(1, (int) $job['copies']);
                    if ($n > $room) {
                        break;
                    }
                    $take[] = $job;
                    $room -= $n;
                }
                $reason = 'livre plein';
            }
            if ($take) {
                $created[] = self::create_lot($g, $take, $reason);
            }
        }
        if ($at_slot) {
            update_option('cb_last_slot', $slot, false);
        }
        return $created;
    }

    private static function create_lot(array $group, array $jobs, string $reason): string
    {
        $id = 'L' . wp_date('ymd-Hi') . '-' . strtoupper(substr(bin2hex(random_bytes(2)), 0, 3));
        $decks = array_sum(array_map(fn($j) => max(1, (int) $j['copies']), $jobs));
        CB_Store::create_lot(['id' => $id, 'status' => 'planned', 'media' => $group['media'], 'format' => $group['format'],
            'reason' => $reason, 'decks' => $decks]);
        foreach ($jobs as $job) {
            CB_Store::update_job($job['uid'], ['status' => 'lotted', 'lot_id' => $id]);
            CB_Store::note((int) $job['order_id'], "Carte Blanche : jeu placé dans le lot $id ($reason).");
        }
        self::enqueue('cb_build_lot', [$id]);
        return $id;
    }

    // --- 3. Imposition et PDF --------------------------------------------------------------------

    public static function lot_file(string $id): string
    {
        return CB_Store::dir('lots') . '/' . sanitize_file_name($id) . '.pdf';
    }

    public static function build_lot(string $id): void
    {
        $lot = CB_Store::lot($id);
        if (!$lot || !in_array($lot['status'], ['planned', 'failed'], true)) {
            return;
        }
        @set_time_limit(300);
        CB_Store::update_lot($id, ['status' => 'building', 'error' => null]);
        try {
            $base = CB_Store::dir('');
            $format = $lot['format'];
            $fmt = CB_Settings::FORMATS[$format];
            $bleed = (float) CB_Settings::get('bleed_mm');
            [$tw, $th] = $fmt['trim'];
            $layout = self::layout($tw, $th, $bleed);
            $per = count($layout['slots']);

            // Jeux du lot : un par exemplaire, la carte d'identification en tête
            $decks = [];
            foreach (CB_Store::jobs_where('lot_id = %s ORDER BY paid_at ASC, id ASC', [$id]) as $job) {
                $print = json_decode((string) @file_get_contents(CB_Store::job_dir($job['uid']) . '/print/print.json'), true);
                if (!$print) {
                    throw new RuntimeException("Jeu {$job['uid']} non préparé.");
                }
                $order = $job['order_id'] ? wc_get_order((int) $job['order_id']) : null;
                $copies = max(1, (int) $job['copies']);
                $fronts = array_map(fn($p) => "$base/$p", $print['fronts']);
                $backs = is_array($print['backs']) ? array_map(fn($p) => "$base/$p", $print['backs']) : "$base/{$print['backs']}";
                for ($c = 1; $c <= $copies; $c++) {
                    $decks[] = ['uid' => $job['uid'], 'fronts' => $fronts, 'backs' => $backs, 'copy' => $c, 'copies' => $copies,
                        'order' => $order ? $order->get_order_number() : '—',
                        'name' => $order ? trim($order->get_formatted_billing_full_name()) : '',
                        'order_id' => (int) $job['order_id']];
                }
            }
            if (!$decks) {
                throw new RuntimeException('Lot vide.');
            }
            // Du plus long au plus court (tri stable : ordre des commandes gardé à longueur égale)
            usort($decks, fn($a, $b) => count($b['fronts']) <=> count($a['fronts']));

            $W = CB_Pdf::mm(self::SHEET['w']);
            $H = CB_Pdf::mm(self::SHEET['h']);
            $file = self::lot_file($id);
            $pdf = new CB_Pdf($file . '.part');
            $books = array_chunk($decks, $per);
            $total = array_sum(array_map(fn($b) => count($b[0]['fronts']) + 1, $books));
            $sheet_no = 0;
            $manifest = ['lot' => $id, 'format' => $format, 'media' => $lot['media'],
                'layout' => sprintf('%d poses (%d × %d%s) sur SRA3', $per, $layout['cols'], $layout['rows'], $layout['rotation'] ? ', pivotées 90°' : ''),
                'books' => []];
            $sep_forms = [];
            $marks = self::marks($layout);
            foreach ($books as $b => $book) {
                $length = count($book[0]['fronts']) + 1;
                $stacks = [];
                foreach ($book as $k => $deck) {
                    $stacks[] = ['stack' => $k + 1, 'order' => $deck['order'], 'name' => $deck['name'], 'copy' => $deck['copy'], 'copies' => $deck['copies'],
                        'cards' => count($deck['fronts']), 'uid' => $deck['uid'], 'order_id' => $deck['order_id']];
                }
                $manifest['books'][] = ['book' => $b + 1, 'first_sheet' => $sheet_no + 1, 'sheets' => $length, 'stacks' => $stacks];
                for ($n = 0; $n < $length; $n++) {
                    $sheet_no++;
                    foreach (['recto', 'verso'] as $side) {
                        $ops = [];
                        $xo = [];
                        foreach ($book as $k => $deck) {
                            $slot = $layout['slots'][$k];
                            if ($side === 'verso') {
                                $slot = self::verso($slot);
                            }
                            if ($n === 0) { // carte d'identification
                                $key = $deck['uid'] . '-' . $deck['copy'] . '-' . $side;
                                $sep_forms[$key] ??= $pdf->form(self::separator($deck, $side, $fmt, $bleed), CB_Pdf::mm($tw + 2 * $bleed), CB_Pdf::mm($th + 2 * $bleed));
                                $obj = $sep_forms[$key];
                                $unit = false;
                            } else {
                                $i = $n - 1;
                                if (!isset($deck['fronts'][$i])) {
                                    continue; // jeu plus court que le livre : pose vide
                                }
                                $src = $side === 'recto' ? $deck['fronts'][$i] : (is_array($deck['backs']) ? $deck['backs'][$i] : $deck['backs']);
                                $obj = $pdf->image($src);
                                $unit = true;
                            }
                            $xo[] = $obj;
                            $ops[] = 'q ' . CB_Pdf::place($slot['x'], $slot['y'], $slot['w'], $slot['h'], $slot['rot'], $unit) . " /X$obj Do Q";
                        }
                        $label = $side === 'recto'
                            ? sprintf('Lot %s · feuille %d/%d · livre %d, feuille %d/%d · RECTO · %s · %s · %s', $id, $sheet_no, $total, $b + 1, $n + 1, $length,
                                CB_Settings::MEDIA[$lot['media']]['label'] ?? $lot['media'], $fmt['label'], $manifest['layout'])
                            : sprintf('Lot %s · feuille %d/%d · VERSO (retournement petit côté)', $id, $sheet_no, $total);
                        $ops[] = ($side === 'recto' ? $marks : '') . sprintf('BT 0 0 0 1 k /F1 6 Tf %.2F %.2F Td %s Tj ET',
                            CB_Pdf::mm(self::SHEET['margin']), CB_Pdf::mm(3), CB_Pdf::text($label));
                        $pdf->page(implode("\n", $ops), $xo, $W, $H);
                    }
                }
            }
            $pdf->close("Lot $id — " . $manifest['layout']);
            rename($file . '.part', $file);
            $manifest['sheets'] = $total;
            CB_Store::update_lot($id, ['status' => 'ready', 'sheets' => $total, 'decks' => count($decks), 'manifest' => $manifest, 'generated_at' => CB_Store::now()]);
            foreach (array_unique(array_column($decks, 'order_id')) as $oid) {
                CB_Store::note($oid, "Carte Blanche : PDF d’impression du lot $id prêt ($total feuilles SRA3).");
            }
        } catch (Throwable $e) {
            @unlink(self::lot_file($id) . '.part');
            CB_Store::update_lot($id, ['status' => 'failed', 'error' => $e->getMessage()]);
        }
    }

    /** Traits de coupe prolongés en bordure de grille, à chaque ligne de coupe (repérage : 4 encres). */
    private static function marks(array $layout): string
    {
        $slots = $layout['slots'];
        $xs = $ys = [];
        foreach ($slots as $s) {
            $d = $s['bleed'];
            $xs[] = round($s['x'] + $d, 3);
            $xs[] = round($s['x'] + $s['w'] - $d, 3);
            $ys[] = round($s['y'] + $d, 3);
            $ys[] = round($s['y'] + $s['h'] - $d, 3);
        }
        $xs = array_unique($xs);
        $ys = array_unique($ys);
        $gx0 = min(array_column($slots, 'x'));
        $gy0 = min(array_column($slots, 'y'));
        $gx1 = max(array_map(fn($s) => $s['x'] + $s['w'], $slots));
        $gy1 = max(array_map(fn($s) => $s['y'] + $s['h'], $slots));
        $off = CB_Pdf::mm(self::MARK_OFFSET);
        $len = CB_Pdf::mm(self::MARK_LENGTH);
        $l = [];
        foreach ($xs as $x) {
            $l[] = sprintf('%.3F %.3F m %.3F %.3F l', $x, $gy1 + $off, $x, $gy1 + $off + $len);
            $l[] = sprintf('%.3F %.3F m %.3F %.3F l', $x, $gy0 - $off, $x, max(0, $gy0 - $off - $len));
        }
        foreach ($ys as $y) {
            $l[] = sprintf('%.3F %.3F m %.3F %.3F l', $gx0 - $off, $y, max(0, $gx0 - $off - $len), $y);
            $l[] = sprintf('%.3F %.3F m %.3F %.3F l', $gx1 + $off, $y, $gx1 + $off + $len, $y);
        }
        return "q 1 1 1 1 K 0.25 w\n" . implode("\n", $l) . "\nS Q\n";
    }

    /** Carte d'identification d'un jeu (en tête de pile, à retirer avant la mise en étui). */
    private static function separator(array $deck, string $side, array $fmt, float $bleed): string
    {
        [$tw, $th] = $fmt['trim'];
        $pw = CB_Pdf::mm($tw + 2 * $bleed);
        $ph = CB_Pdf::mm($th + 2 * $bleed);
        $b = CB_Pdf::mm($bleed);
        $center = function (string $text, float $size, float $y) use ($pw): string {
            $width = 0.53 * $size * mb_strlen($text); // largeur approchée (Helvetica)
            return sprintf('BT /F1 %.2F Tf %.2F %.2F Td %s Tj ET', $size, max(2, ($pw - $width) / 2), $y, CB_Pdf::text($text));
        };
        $order = '#' . $deck['order'];
        $big = min(26, 26 * CB_Pdf::mm($tw - 12) / max(1, 0.53 * 26 * mb_strlen($order)));
        $ops = [sprintf('0 0 0 0.06 k 0 0 %.2F %.2F re f', $pw, $ph), '0 0 0 1 k'];
        $ops[] = $center('JEU POUR LA COMMANDE', 7, $ph - $b - CB_Pdf::mm(10));
        $ops[] = $center($order, $big, $ph - $b - CB_Pdf::mm(21));
        $ops[] = $center($deck['copies'] > 1 ? "Jeu {$deck['copy']} / {$deck['copies']}" : 'Jeu unique', 13, $ph - $b - CB_Pdf::mm(30));
        if ($deck['name'] !== '') {
            $ops[] = $center(mb_substr($deck['name'], 0, 28), 9, $ph - $b - CB_Pdf::mm(37));
        }
        $ops[] = $center(count($deck['fronts']) . ' cartes · ' . $fmt['label'], 6.5, $ph - $b - CB_Pdf::mm(43));
        $ops[] = sprintf('0 0 0 1 K 0.6 w %.2F %.2F %.2F %.2F re S', $b + CB_Pdf::mm(4), $b + CB_Pdf::mm(4), $pw - 2 * $b - CB_Pdf::mm(8), $ph - 2 * $b - CB_Pdf::mm(8));
        $ops[] = $center(strtoupper($side) . ' · à retirer avant mise en étui', 5.5, $b + CB_Pdf::mm(7));
        $ops[] = $center(substr($deck['uid'], 0, 12), 5, $b + CB_Pdf::mm(10));
        return implode("\n", $ops);
    }

    // --- Atelier -----------------------------------------------------------------------------------

    /** Traite ce qui attend (préparations, amalgame, lots à fabriquer) dans la limite de temps. */
    public static function run_now(int $budget = 100): array
    {
        $start = microtime(true);
        $done = ['prepared' => 0, 'lots' => []];
        foreach (CB_Store::jobs_where("status IN ('paid', 'preparing') ORDER BY paid_at ASC") as $job) {
            $left = $budget - (microtime(true) - $start);
            if ($left < 10) {
                break;
            }
            if (self::prepare_job($job['uid'], (int) $left)) {
                $done['prepared']++;
            }
        }
        $done['lots'] = self::plan_lots();
        foreach (CB_Store::recent_lots(20) as $lot) {
            if ($lot['status'] === 'planned' && microtime(true) - $start < $budget) {
                self::build_lot($lot['id']);
            }
        }
        return $done;
    }

    public static function mark_printed(string $id): void
    {
        $lot = CB_Store::lot($id);
        if (!$lot || $lot['status'] !== 'ready') {
            return;
        }
        CB_Store::update_lot($id, ['status' => 'printed', 'printed_at' => CB_Store::now()]);
        foreach (CB_Store::jobs_where('lot_id = %s', [$id]) as $job) {
            CB_Store::update_job($job['uid'], ['status' => 'printed']);
            CB_Store::note((int) $job['order_id'], "Carte Blanche : jeu imprimé (lot $id), prêt pour le façonnage.");
        }
    }
}
