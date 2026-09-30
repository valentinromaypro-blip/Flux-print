<?php
/**
 * Conditionnement d'un jeu : sous film rétractable (de base), étui à fenêtre Carte Blanche (stock),
 * ou étui fermé personnalisé, imprimé et façonné par une autre structure du groupe.
 *
 * Étui personnalisé : étui à rabats inversés (« reverse tuck end ») calculé pour le format et
 * l'épaisseur du jeu. Le même gabarit sert au studio (studio/src/lib/box.ts, à garder identique),
 * au modèle PDF téléchargeable, au contrôle du fichier du client et au PDF remis à l'imprimeur :
 * image CMJN à fond perdu, tracé de découpe (ton direct CutContour) et de rainage (ton direct
 * Rainage, pointillés), en surimpression.
 */

defined('ABSPATH') || exit;

final class CB_Box
{
    public const PACKS = [
        'film' => ['label' => 'Sous film rétractable', 'hint' => 'Le jeu nu, protégé par un film', 'price' => 0.0],
        'fenetre' => ['label' => 'Étui à fenêtre Carte Blanche', 'hint' => 'Étui cartonné ; la fenêtre laisse voir le dos de vos cartes', 'price' => 3.0,
            'formats' => ['poker']],
        'custom' => ['label' => 'Étui personnalisé', 'hint' => 'Étui fermé imprimé à votre image, sur toutes ses faces', 'price' => 6.0],
    ];

    /** Épaisseur d'une carte (mm) selon le carton : sert à la profondeur de l'étui. À confirmer à l'atelier. */
    public const CALIPER = ['cmdm-350g' => 0.40, 'carte-graphique-300g' => 0.34];

    public const DPI = 300;
    private const GLUE = 12.0;   // patte de collage
    private const TUCK = 15.0;   // languette des rabats
    private const DUST = 14.0;   // cache-poussière
    private const PLAY = 1.5;    // jeu autour des cartes
    private const MARGIN = 12.0; // marge du PDF de l'imprimeur autour du fond perdu

    public static function price(string $pack): float
    {
        $custom = CB_Settings::get("pack_price_$pack");
        return (float) ($custom !== null && $custom !== '' ? $custom : (self::PACKS[$pack]['price'] ?? 0));
    }

    /** Conditionnements proposés pour ce jeu (clés de PACKS). */
    public static function offered(array $deck, string $format): array
    {
        return array_keys(array_filter(self::PACKS, fn($p) => !isset($p['formats']) || in_array($format, $p['formats'], true)));
    }

    public static function label(string $pack): string
    {
        return self::PACKS[$pack]['label'] ?? self::PACKS['film']['label'];
    }

    /**
     * Gabarit à plat, en mm, origine en haut à gauche (fond perdu non compris).
     * De gauche à droite : patte de collage, dos, tranche gauche, face, tranche droite.
     * Rabat du haut (et sa languette) sur le dos, rabat du bas sur la face ; cache-poussière sur les tranches.
     */
    public static function geometry(string $format, int $cards, string $media): array
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $w = $tw + self::PLAY;
        $h = $th + self::PLAY;
        $d = round($cards * (self::CALIPER[$media] ?? 0.40) + self::PLAY, 1);
        [$g, $t, $f] = [self::GLUE, self::TUCK, min(self::DUST, $w * 0.4)];
        $top = $d + $t;
        $xb = $g;
        $xs1 = $g + $w;
        $xf = $xs1 + $d;
        $xs2 = $xf + $w;
        $W = $xs2 + $d;
        $H = $h + 2 * $top;
        $yT = $top;
        $yB = $top + $h;
        $c = min(5.0, $t / 3); // chanfrein des languettes
        $cut = [
            [$xb, $yT], [0, $yT + 5], [0, $yB - 5], [$xb, $yB],                       // patte de collage
            [$xs1, $yB],                                                               // bas du dos
            [$xs1 + 0.5, $yB + $f - 2], [$xs1 + 2, $yB + $f], [$xf - 1, $yB + $f], [$xf, $yB + 3], [$xf, $yB], // cache-poussière
            [$xf, $yB + $d], [$xf, $yB + $d + $t - $c], [$xf + $c, $yB + $d + $t],     // rabat du bas et languette
            [$xs2 - $c, $yB + $d + $t], [$xs2, $yB + $d + $t - $c], [$xs2, $yB + $d], [$xs2, $yB],
            [$xs2, $yB + 3], [$xs2 + 1, $yB + $f], [$W - 2, $yB + $f], [$W - 0.5, $yB + $f - 2], [$W, $yB],
            [$W, $yT],                                                                 // tranche droite
            [$W - 0.5, $yT - $f + 2], [$W - 2, $yT - $f], [$xs2 + 1, $yT - $f], [$xs2, $yT - 3], [$xs2, $yT],
            [$xf, $yT],                                                                // haut de la face (ouverture)
            [$xf, $yT - 3], [$xf - 1, $yT - $f], [$xs1 + 2, $yT - $f], [$xs1 + 0.5, $yT - $f + 2], [$xs1, $yT],
            [$xs1, $yT - $d], [$xs1, $yT - $d - $t + $c], [$xs1 - $c, $yT - $d - $t], // rabat du haut et languette
            [$xb + $c, $yT - $d - $t], [$xb, $yT - $d - $t + $c], [$xb, $yT - $d], [$xb, $yT],
        ];
        $crease = [
            [$xb, $yT, $xb, $yB], [$xs1, $yT, $xs1, $yB], [$xf, $yT, $xf, $yB], [$xs2, $yT, $xs2, $yB],
            [$xb, $yT, $xs1, $yT], [$xb, $yT - $d, $xs1, $yT - $d],                 // rabat du haut
            [$xs1, $yT, $xf, $yT], [$xs2, $yT, $W, $yT],                             // cache-poussière du haut
            [$xf, $yB, $xs2, $yB], [$xf, $yB + $d, $xs2, $yB + $d],                 // rabat du bas
            [$xs1, $yB, $xf, $yB], [$xs2, $yB, $W, $yB],                             // cache-poussière du bas
        ];
        return [
            'w' => $w, 'h' => $h, 'd' => $d, 'W' => round($W, 2), 'H' => round($H, 2), 'bleed' => (float) CB_Settings::get('bleed_mm'),
            'panels' => [
                'glue' => [0, $yT, $g, $h], 'back' => [$xb, $yT, $w, $h], 'left' => [$xs1, $yT, $d, $h],
                'front' => [$xf, $yT, $w, $h], 'right' => [$xs2, $yT, $d, $h],
                'top' => [$xb, $t, $w, $d], 'bottom' => [$xf, $yB, $w, $d],
            ],
            'cut' => $cut, 'crease' => $crease,
        ];
    }

    /** Taille en pixels de l'image de l'étui (fond perdu compris) à 300 dpi. */
    public static function px(array $g): array
    {
        $b = 2 * $g['bleed'];
        return [(int) round(($g['W'] + $b) / 25.4 * self::DPI), (int) round(($g['H'] + $b) / 25.4 * self::DPI)];
    }

    public static function for_job(array $job): array
    {
        return self::geometry($job['format'], (int) ($job['cards'] ?: CB_Settings::deck($job['deck'])['cards']), $job['media']);
    }

    // --- Contrôle ---------------------------------------------------------------------------------

    /** Fichier d'étui déposé pour ce travail : 'jpg' (studio), 'pdf' (client) ou null. */
    public static function source(array $job): ?string
    {
        $dir = CB_Store::job_dir($job['uid']);
        return is_file("$dir/box.pdf") ? 'pdf' : (is_file("$dir/cards/box.jpg") ? 'jpg' : null);
    }

    /**
     * Contrôle de l'étui personnalisé (après celui des cartes, dont il dépend pour le nombre de cartes).
     * Renvoie les messages d'erreur ; prépare l'aperçu « box » si tout va bien.
     */
    public static function check(array $job): array
    {
        if (($job['pack'] ?? 'film') !== 'custom') {
            return [];
        }
        $dir = CB_Store::job_dir($job['uid']);
        $g = self::for_job($job);
        [$pw, $ph] = self::px($g);
        $size = sprintf('%s × %s mm', self::mm($g['W'] + 2 * $g['bleed']), self::mm($g['H'] + 2 * $g['bleed']));
        $source = self::source($job);
        if (!$source) {
            return [['level' => 'error', 'title' => 'L’étui personnalisé est manquant', 'help' => 'Créez l’étui en ligne ou déposez son PDF, puis validez à nouveau.']];
        }
        if ($source === 'jpg') {
            $s = @getimagesize("$dir/cards/box.jpg");
            if (!$s || abs($s[0] - $pw) > 2 || abs($s[1] - $ph) > 2) {
                return [['level' => 'error', 'title' => 'L’étui n’a pas été préparé correctement', 'help' => 'Validez à nouveau votre jeu.']];
            }
            self::thumb("$dir/cards/box.jpg", "$dir/preview-box.jpg");
            return [];
        }
        try {
            $one = CB_Check::render_pages("$dir/box.pdf", "$dir/boxsize-%03d.jpg", 72, 1, 1);
            $s = $one ? getimagesize($one[0]) : null;
            if ($s && abs($s[0] - $pw * 72 / self::DPI) <= 4 && abs($s[1] - $ph * 72 / self::DPI) <= 4) {
                array_map('unlink', $one);
                $prev = CB_Check::render_pages("$dir/box.pdf", "$dir/boxprev-%03d.jpg", 60, 1, 1);
                if ($prev) {
                    rename($prev[0], "$dir/preview-box.jpg");
                }
                return [];
            }
            array_map('unlink', $one);
            $got = $s ? sprintf('%s × %s mm', self::mm($s[0] / 72 * 25.4), self::mm($s[1] / 72 * 25.4)) : 'illisible';
            return [['level' => 'error', 'title' => 'Le PDF de l’étui n’a pas le bon format',
                'help' => "Page reçue : $got ; attendue : $size (gabarit fond perdu compris). Téléchargez le gabarit correspondant à votre jeu."]];
        } catch (Throwable $e) {
            return [['level' => 'error', 'title' => 'Le PDF de l’étui est illisible', 'help' => $e->getMessage()]];
        }
    }

    private static function mm(float $v): string
    {
        return str_replace('.', ',', (string) round($v, 1));
    }

    private static function thumb(string $src, string $dst): void
    {
        $img = wp_get_image_editor($src);
        if (!is_wp_error($img)) {
            $img->resize(600, null);
            $img->set_quality(82);
            $img->save($dst, 'image/jpeg');
        }
    }

    // --- Fabrication --------------------------------------------------------------------------------

    /** Image CMJN de l'étui d'un travail payé (print/box.jpg), depuis l'image du studio ou le PDF du client. */
    public static function prepare(array $job): ?string
    {
        if (($job['pack'] ?? 'film') !== 'custom') {
            return null;
        }
        $dir = CB_Store::job_dir($job['uid']);
        $dst = CB_Store::dir('jobs/' . $job['uid'] . '/print') . '/box.jpg';
        if (!is_file($dst)) {
            $g = self::for_job($job);
            $src = "$dir/cards/box.jpg";
            if (self::source($job) === 'pdf') {
                $pages = CB_Check::render_pages("$dir/box.pdf", "$dir/boxhd-%03d.jpg", self::DPI, 1, 1);
                if (!$pages) {
                    throw new RuntimeException('PDF de l’étui illisible.');
                }
                $src = $pages[0];
            }
            CB_Production::to_cmyk($src, $dst, self::px($g));
            if ($src !== "$dir/cards/box.jpg") {
                @unlink($src);
            }
        }
        return $dst;
    }

    /** Tracés de découpe et de rainage (opérateurs PDF), gabarit posé en ($x0, $y0) mm, page de hauteur $ph pt. */
    private static function dieline(array $g, float $x0, float $y0, float $ph, int $cut, int $crease, int $op): string
    {
        $P = fn($x, $y) => sprintf('%.3F %.3F', CB_Pdf::mm($x0 + $x), $ph - CB_Pdf::mm($y0 + $y));
        $path = [];
        foreach ($g['cut'] as $i => [$x, $y]) {
            $path[] = $P($x, $y) . ($i ? ' l' : ' m');
        }
        $lines = array_map(fn($l) => $P($l[0], $l[1]) . ' m ' . $P($l[2], $l[3]) . ' l', $g['crease']);
        return "q /GS$op gs /CS$cut CS 1 SC 0.5 w 1 j\n" . implode("\n", $path) . " h S Q\n"
            . "q /GS$op gs /CS$crease CS 1 SC 0.5 w [3 2] 0 d\n" . implode("\n", $lines) . "\nS Q\n";
    }

    /**
     * PDF des étuis personnalisés d'un lot, pour l'imprimeur du groupe : une page par jeu (étui à
     * plat, fond perdu, tracés en tons directs, repère de commande et nombre d'exemplaires).
     */
    public static function lot_pdf(string $file, string $lot, array $items): void
    {
        $pdf = new CB_Pdf($file . '.part');
        $cut = $pdf->spot('CutContour', [0, 1, 0, 0]);
        $crease = $pdf->spot('Rainage', [1, 0, 0, 0]);
        $op = $pdf->overprint();
        $res = "/ColorSpace << /CS$cut $cut 0 R /CS$crease $crease 0 R >> /ExtGState << /GS$op $op 0 R >>";
        foreach ($items as $it) {
            $g = $it['geometry'];
            $b = $g['bleed'];
            $m = self::MARGIN;
            $pw = CB_Pdf::mm($g['W'] + 2 * ($b + $m));
            $ph = CB_Pdf::mm($g['H'] + 2 * ($b + $m));
            $img = $pdf->image($it['image']);
            $ops = [sprintf('q %.3F 0 0 %.3F %.3F %.3F cm /X%d Do Q', CB_Pdf::mm($g['W'] + 2 * $b), CB_Pdf::mm($g['H'] + 2 * $b), CB_Pdf::mm($m), CB_Pdf::mm($m), $img)];
            $ops[] = self::dieline($g, $m + $b, $m + $b, $ph, $cut, $crease, $op);
            $label = sprintf('Lot %s · commande #%s · %s · %d exemplaire(s) · étui %s × %s × %s mm · découpe : CutContour · rainage : Rainage (pointillés)',
                $lot, $it['order'], $it['name'], $it['copies'], self::mm($g['w']), self::mm($g['h']), self::mm($g['d']));
            $ops[] = sprintf('BT 0 0 0 1 k /F1 6 Tf %.2F %.2F Td %s Tj ET', CB_Pdf::mm($m), CB_Pdf::mm(4), CB_Pdf::text($label));
            $pdf->page(implode("\n", $ops), [$img], $pw, $ph, $res);
        }
        $pdf->close("Étuis personnalisés — lot $lot");
        rename($file . '.part', $file);
    }

    /** Gabarit PDF vierge (fond perdu, zones nommées, tracés) pour le client qui fait son étui lui-même. */
    public static function template_pdf(array $g, string $title): string
    {
        $file = tempnam(get_temp_dir(), 'cb-etui');
        $pdf = new CB_Pdf($file);
        $cut = $pdf->spot('CutContour', [0, 1, 0, 0]);
        $crease = $pdf->spot('Rainage', [1, 0, 0, 0]);
        $op = $pdf->overprint();
        $b = $g['bleed'];
        $pw = CB_Pdf::mm($g['W'] + 2 * $b);
        $ph = CB_Pdf::mm($g['H'] + 2 * $b);
        $ops = ['0 0 0 0.04 k 0 0 ' . sprintf('%.3F %.3F', $pw, $ph) . ' re f'];
        $names = ['glue' => 'COLLE', 'back' => 'DOS', 'left' => 'TRANCHE', 'front' => 'FACE', 'right' => 'TRANCHE', 'top' => 'RABAT', 'bottom' => 'RABAT'];
        foreach ($g['panels'] as $k => [$x, $y, $w, $h]) {
            $size = in_array($k, ['front', 'back'], true) ? 14 : 6;
            $tx = CB_Pdf::mm($b + $x + $w / 2) - 0.3 * $size * strlen($names[$k]);
            $ty = $ph - CB_Pdf::mm($b + $y + $h / 2) - $size / 3;
            $ops[] = sprintf('BT 0 0 0 0.35 k /F1 %d Tf %.2F %.2F Td %s Tj ET', $size, $tx, $ty, CB_Pdf::text($names[$k]));
        }
        $ops[] = sprintf('BT 0 0 0 0.5 k /F1 6 Tf %.2F %.2F Td %s Tj ET', CB_Pdf::mm($b + 1), CB_Pdf::mm(1), CB_Pdf::text(
            "$title · étui {$g['w']} × {$g['h']} × {$g['d']} mm · fond perdu {$b} mm tout autour · supprimez ces textes et tracés, gardez le format de la page"));
        $ops[] = self::dieline($g, $b, $b, $ph, $cut, $crease, $op);
        $pdf->page(implode("\n", $ops), [], $pw, $ph,
            "/ColorSpace << /CS$cut $cut 0 R /CS$crease $crease 0 R >> /ExtGState << /GS$op $op 0 R >>");
        $pdf->close("Gabarit étui — $title");
        return $file;
    }
}
