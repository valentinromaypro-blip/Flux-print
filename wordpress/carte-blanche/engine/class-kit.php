<?php
/**
 * Kit de création pour les clients qui font leur jeu eux-mêmes (Canva, Illustrator, InDesign,
 * Photoshop, Affinity…) : gabarits au format exact du jeu, fiche technique, gabarit d'étui et
 * mode d'emploi, en un ZIP (ou fichier par fichier).
 *
 *   gabarit-jeu.pdf      une page par page attendue (dos, puis faces dans l'ordre), nommée,
 *                        avec fond perdu, coupe et zone de sécurité tracés
 *   gabarit-carte.png    une carte à 350 dpi, mêmes repères (Photoshop, Canva)
 *   gabarit-carte.svg    une carte en mm (Illustrator, Affinity, Inkscape)
 *   gabarit-etui.pdf     l'étui personnalisé calculé pour ce jeu
 *   fiche-technique.pdf  formats, fond perdu, couleurs, résolution, ordre des cartes
 *   LISEZ-MOI.txt        mode d'emploi, dont Canva pas à pas
 */

defined('ABSPATH') || exit;

final class CB_Kit
{
    private const SAFE = 4.0;     // zone de sécurité, mm à l'intérieur de la coupe
    private const CORNER = 3.5;   // rayon des coins arrondis (option)
    public const FILES = ['gabarit-jeu.pdf', 'gabarit-carte.png', 'gabarit-carte.svg', 'gabarit-etui.pdf', 'fiche-technique.pdf', 'LISEZ-MOI.txt'];

    private const SUITS = ['S' => 'pique', 'H' => 'cœur', 'D' => 'carreau', 'C' => 'trèfle'];
    private const RANKS = ['A' => 'As', 'J' => 'Valet', 'Q' => 'Dame', 'K' => 'Roi'];

    public static function init(): void
    {
        add_shortcode('cb_kits', [self::class, 'shortcode']);
    }

    /** Nom lisible d'une carte (« As de pique », « 10 de cœur », « Joker 1 »). */
    public static function card_name(string $code): string
    {
        [$s, $r] = explode('-', $code);
        if ($s === 'JK') {
            return "Joker $r";
        }
        return (self::RANKS[$r] ?? $r) . ' de ' . self::SUITS[$s];
    }

    /** Pages attendues dans le PDF du client, dans l'ordre, nommées. */
    public static function pages(string $deck, int $cards): array
    {
        $d = CB_Settings::deck($deck);
        $names = isset($d['cards_min'])
            ? array_map(fn($i) => "Carte $i", range(1, $cards))
            : array_map([self::class, 'card_name'], CB_Production::codes($deck));
        if ($d['backs'] === 'individual') {
            $out = [];
            foreach ($names as $n) {
                $out[] = "$n — face";
                $out[] = "$n — dos";
            }
            return $out;
        }
        return ['Dos (commun à toutes les cartes)', ...$names];
    }

    private static function mm(float $v): string
    {
        return str_replace('.', ',', rtrim(rtrim(sprintf('%.1f', $v), '0'), '.'));
    }

    /** Opérateurs PDF des repères d'une page (fond perdu rose, coupe magenta, sécurité en pointillés). */
    private static function guides(float $tw, float $th, float $b): string
    {
        $P = fn($v) => CB_Pdf::mm($v);
        $s = self::SAFE;
        return implode("\n", [
            sprintf('0 0.1 0.05 0 k 0 0 %.3F %.3F re f', $P($tw + 2 * $b), $P($th + 2 * $b)),
            sprintf('0 0 0 0 k %.3F %.3F %.3F %.3F re f', $P($b), $P($b), $P($tw), $P($th)),
            sprintf('0 1 0 0 K 0.5 w %.3F %.3F %.3F %.3F re S', $P($b), $P($b), $P($tw), $P($th)),
            sprintf('1 0 0 0 K 0.4 w [2 2] 0 d %.3F %.3F %.3F %.3F re S [] 0 d', $P($b + $s), $P($b + $s), $P($tw - 2 * $s), $P($th - 2 * $s)),
        ]);
    }

    /** Texte centré (Helvetica, largeur approchée). */
    private static function center(string $text, float $size, float $y, float $pw, string $color = '0 0 0 0.55 k'): string
    {
        $w = 0.53 * $size * mb_strlen($text);
        return sprintf('BT %s /F1 %.2F Tf %.2F %.2F Td %s Tj ET', $color, $size, max(2, ($pw - $w) / 2), $y, CB_Pdf::text($text));
    }

    public static function deck_pdf(string $file, string $deck, string $format, int $cards): void
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $b = (float) CB_Settings::get('bleed_mm');
        $pw = CB_Pdf::mm($tw + 2 * $b);
        $ph = CB_Pdf::mm($th + 2 * $b);
        $pages = self::pages($deck, $cards);
        $n = count($pages);
        $pdf = new CB_Pdf($file);
        foreach ($pages as $i => $name) {
            $ops = [self::guides($tw, $th, $b)];
            $big = min(13, ($pw - CB_Pdf::mm(2 * $b + 8)) / max(1, 0.56 * mb_strlen($name)));
            $ops[] = self::center($name, $big, $ph * 0.55, $pw, '0 0 0 0.6 k');
            $ops[] = self::center(sprintf('page %d / %d', $i + 1, $n), 7, $ph * 0.55 - 14, $pw);
            $ops[] = self::center('Rose : fond perdu (coupé) · Magenta : coupe', 4.6, CB_Pdf::mm($b + self::SAFE + 6), $pw);
            $ops[] = self::center('Pointillés : zone de sécurité · supprimez ces repères', 4.6, CB_Pdf::mm($b + self::SAFE + 3), $pw);
            $pdf->page(implode("\n", $ops), [], $pw, $ph);
        }
        $pdf->close('Gabarit ' . CB_Settings::FORMATS[$format]['label'] . " — $n pages");
    }

    public static function card_svg(string $format): string
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $b = (float) CB_Settings::get('bleed_mm');
        $s = self::SAFE;
        $W = $tw + 2 * $b;
        $H = $th + 2 * $b;
        $f = fn($v) => rtrim(rtrim(sprintf('%.2f', $v), '0'), '.');
        return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{$f($W)}mm\" height=\"{$f($H)}mm\" viewBox=\"0 0 {$f($W)} {$f($H)}\">\n"
            . "<title>Gabarit carte " . esc_html(CB_Settings::FORMATS[$format]['label']) . " + {$f($b)} mm de fond perdu</title>\n"
            . "<g id=\"reperes\" fill=\"none\">\n"
            . "<rect width=\"{$f($W)}\" height=\"{$f($H)}\" fill=\"#F7D6DD\"/>\n"
            . "<rect id=\"coupe\" x=\"{$f($b)}\" y=\"{$f($b)}\" width=\"{$f($tw)}\" height=\"{$f($th)}\" fill=\"#fff\" stroke=\"#E4007C\" stroke-width=\"0.2\"/>\n"
            . "<rect id=\"coins-arrondis\" x=\"{$f($b)}\" y=\"{$f($b)}\" width=\"{$f($tw)}\" height=\"{$f($th)}\" rx=\"" . self::CORNER . "\" stroke=\"#E4007C\" stroke-width=\"0.12\" stroke-dasharray=\"0.6 0.6\"/>\n"
            . "<rect id=\"securite\" x=\"{$f($b + $s)}\" y=\"{$f($b + $s)}\" width=\"{$f($tw - 2 * $s)}\" height=\"{$f($th - 2 * $s)}\" stroke=\"#00A0E3\" stroke-width=\"0.2\" stroke-dasharray=\"1 1\"/>\n"
            . "</g>\n<!-- Placez votre visuel dans un calque au-dessus, jusqu'aux bords (fond perdu), puis supprimez le groupe « reperes ». -->\n</svg>\n";
    }

    public static function card_png(string $file, string $format): void
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $b = (float) CB_Settings::get('bleed_mm');
        $dpi = (int) CB_Settings::get('dpi');
        $k = $dpi / 25.4;
        [$w, $h] = [(int) round(($tw + 2 * $b) * $k), (int) round(($th + 2 * $b) * $k)];
        $im = new Imagick();
        $im->newImage($w, $h, new ImagickPixel('#F7D6DD'));
        $d = new ImagickDraw();
        $d->setFillColor('#FFFFFF');
        $d->setStrokeColor('#E4007C');
        $d->setStrokeWidth(2);
        $d->rectangle($b * $k, $b * $k, ($b + $tw) * $k, ($b + $th) * $k);
        $d->setFillOpacity(0);
        $d->setStrokeColor('#00A0E3');
        $d->setStrokeDashArray([12, 12]);
        $s = self::SAFE;
        $d->rectangle(($b + $s) * $k, ($b + $s) * $k, ($b + $tw - $s) * $k, ($b + $th - $s) * $k);
        $im->drawImage($d);
        $t = new ImagickDraw();
        $t->setFont(CB_DIR . '/assets/backs/fonts/cb-sans.ttf');
        $t->setFillColor('#9A8F93');
        $t->setFontSize(26);
        $t->setGravity(Imagick::GRAVITY_CENTER);
        $im->annotateImage($t, 0, 0, 0, sprintf("Carte %s × %s mm\n+ %s mm de fond perdu\n%d × %d px à %d dpi", self::mm($tw), self::mm($th), self::mm($b), $w, $h, $dpi));
        $im->setImageUnits(Imagick::RESOLUTION_PIXELSPERINCH);
        $im->setImageResolution($dpi, $dpi);
        $im->setImageFormat('png');
        $im->writeImage($file);
        $im->clear();
    }

    /** Fiche technique A4 (une page). */
    public static function sheet_pdf(string $file, string $deck, string $format, int $cards): void
    {
        $d = CB_Settings::deck($deck);
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $b = (float) CB_Settings::get('bleed_mm');
        $dpi = (int) CB_Settings::get('dpi');
        [$pxw, $pxh] = [(int) round(($tw + 2 * $b) / 25.4 * $dpi), (int) round(($th + 2 * $b) / 25.4 * $dpi)];
        $pages = self::pages($deck, $cards);
        $order = isset($d['cards_min'])
            ? "Dos en page 1, puis vos cartes dans l'ordre ($d[cards_min] à $d[cards_max] cartes)."
            : 'Dos en page 1, puis les faces : pique, cœur, carreau, trèfle ; dans chaque couleur ' . ($deck === '32' ? 'as, 7, 8, 9, 10, valet, dame, roi' : "as, 2 à 10, valet, dame, roi ; puis les 2 jokers") . '.';
        $lines = [
            ['h', 'Fiche technique — ' . strip_tags(get_bloginfo('name'))],
            ['p', $d['label'] . ' · ' . CB_Settings::FORMATS[$format]['label']],
            ['h2', 'Format des pages'],
            ['p', sprintf('Carte finie : %s × %s mm. Avec fond perdu : %s × %s mm (%s mm de chaque côté).', self::mm($tw), self::mm($th), self::mm($tw + 2 * $b), self::mm($th + 2 * $b), self::mm($b))],
            ['p', sprintf('En pixels à %d dpi : %d × %d px (minimum conseillé à 300 dpi : %d × %d px).', $dpi, $pxw, $pxh, (int) round(($tw + 2 * $b) / 25.4 * 300), (int) round(($th + 2 * $b) / 25.4 * 300))],
            ['p', sprintf('Zone de sécurité : gardez textes et éléments importants à %s mm à l\'intérieur de la coupe.', self::mm(self::SAFE))],
            ['p', sprintf('Coins arrondis (option) : rayon %s mm, rien d\'important dans les coins.', self::mm(self::CORNER))],
            ['h2', 'Le fichier'],
            ['p', sprintf('Un seul PDF de %d pages, une carte par page, sans traits de coupe ni repères.', count($pages))],
            ['p', $order],
            ['p', 'Ou des images (JPG, PNG), une par carte, au format avec fond perdu.'],
            ['h2', 'Couleurs et qualité'],
            ['p', 'RVB (sRVB) ou CMJN : nous convertissons pour la presse (PSO Coated v3 / FOGRA51).'],
            ['p', 'Les couleurs très vives à l\'écran (fluo, vert ou bleu électrique) sortent plus ternes à l\'impression.'],
            ['p', 'Images à 300 dpi au moins ; polices incorporées (export « PDF pour impression »).'],
            ['p', 'Textes de 6 pt au moins ; traits de 0,1 mm au moins ; noir intense pour les grands aplats noirs.'],
            ['h2', 'Avant de payer'],
            ['p', 'Le site contrôle votre fichier et vous montre tout le jeu, carte par carte, avec la ligne de coupe.'],
        ];
        $W = CB_Pdf::mm(210);
        $H = CB_Pdf::mm(297);
        $y = $H - CB_Pdf::mm(22);
        $x = CB_Pdf::mm(20);
        $ops = [];
        foreach ($lines as [$kind, $text]) {
            [$size, $gap] = ['h' => [17, 26], 'h2' => [11.5, 22], 'p' => [9.5, 14]][$kind];
            if ($kind === 'h2') {
                $y -= 6;
            }
            foreach ($kind === 'p' ? self::wrap($text, 100) : [$text] as $l) {
                $ops[] = sprintf('BT 0 0 0 %s k /F1 %.1F Tf %.2F %.2F Td %s Tj ET', $kind === 'p' ? '0.85' : '1', $size, $x, $y, CB_Pdf::text($l));
                $y -= $gap;
                $gap = 13;
            }
        }
        $pdf = new CB_Pdf($file);
        $pdf->page(implode("\n", $ops), [], $W, $H);
        $pdf->close('Fiche technique');
    }

    private static function wrap(string $text, int $max): array
    {
        $out = [];
        $line = '';
        foreach (explode(' ', $text) as $w) {
            if ($line !== '' && mb_strlen("$line $w") > $max) {
                $out[] = $line;
                $line = $w;
            } else {
                $line = $line === '' ? $w : "$line $w";
            }
        }
        return [...$out, $line];
    }

    public static function readme(string $deck, string $format, int $cards): string
    {
        [$tw, $th] = CB_Settings::FORMATS[$format]['trim'];
        $b = (float) CB_Settings::get('bleed_mm');
        $n = count(self::pages($deck, $cards));
        $W = self::mm($tw + 2 * $b);
        $H = self::mm($th + 2 * $b);
        return <<<TXT
        KIT DE CRÉATION — {$n} pages au format {$W} × {$H} mm (fond perdu compris)

        CONTENU
          gabarit-jeu.pdf      toutes les pages du jeu, dans l'ordre, nommées (« As de pique »…)
          gabarit-carte.png    une carte avec ses repères (Photoshop, Canva)
          gabarit-carte.svg    une carte en millimètres (Illustrator, Affinity, Inkscape)
          gabarit-etui.pdf     l'étui personnalisé de ce jeu (si vous le prenez en option)
          fiche-technique.pdf  formats, couleurs, résolution, ordre des cartes

        LES REPÈRES
          Rose        fond perdu : votre fond doit aller jusqu'au bord, cette bande est coupée
          Magenta     ligne de coupe
          Pointillés  zone de sécurité : rien d'important au-delà
          Supprimez ou masquez les repères avant d'exporter.

        AVEC CANVA
          1. « Créer un design » → « Taille personnalisée » → {$W} × {$H} mm.
          2. Une page par carte, dans l'ordre du gabarit-jeu.pdf (dos en premier).
             Astuce : importez gabarit-carte.png, posez-le sur chaque page, verrouillez-le,
             créez par-dessus, puis supprimez-le avant l'export.
          3. Partager → Télécharger → « PDF pour impression ».
             NE COCHEZ PAS « Traits de coupe et fond perdu » : le format est déjà le bon.
          4. Déposez le PDF sur la fiche du jeu, « J'ai mes fichiers ».

        AVEC ILLUSTRATOR, INDESIGN, AFFINITY
          Ouvrez gabarit-jeu.pdf (ou créez un document {$W} × {$H} mm, {$n} plans de travail),
          placez vos visuels sur un calque au-dessus, exportez en PDF sans repères ni traits de coupe.

        AVEC DES IMAGES
          Une image par carte, {$W} × {$H} mm à 300 dpi au moins. Nommez-les par carte
          (« dos.png », « as-pique.png », « 10-coeur.png », « roi-trefle.png », « joker-1.png »)
          ou numérotez-les dans l'ordre (01.png, 02.png…).

        TXT;
    }

    /** Fichier du kit, préparé une fois par jeu, format, nombre de cartes et version du plugin. */
    public static function file(string $deck, string $format, int $cards, string $name): string
    {
        $dir = CB_Store::dir('kits/' . sanitize_file_name("$deck-$format-$cards-" . CB_VERSION));
        $path = "$dir/$name";
        if (is_file($path)) {
            return $path;
        }
        switch ($name) {
            case 'gabarit-jeu.pdf':
                self::deck_pdf($path, $deck, $format, $cards);
                break;
            case 'gabarit-carte.png':
                self::card_png($path, $format);
                break;
            case 'gabarit-carte.svg':
                file_put_contents($path, self::card_svg($format));
                break;
            case 'gabarit-etui.pdf':
                $tmp = CB_Box::template_pdf(CB_Box::geometry($format, $cards, 'cmdm-350g'),
                    CB_Settings::deck($deck)['label'] . ' · ' . CB_Settings::FORMATS[$format]['label']);
                rename($tmp, $path);
                @chmod($path, 0644);
                break;
            case 'fiche-technique.pdf':
                self::sheet_pdf($path, $deck, $format, $cards);
                break;
            case 'LISEZ-MOI.txt':
                file_put_contents($path, self::readme($deck, $format, $cards));
                break;
            case 'kit.zip':
                $zip = new ZipArchive();
                $zip->open("$path.part", ZipArchive::CREATE | ZipArchive::OVERWRITE);
                foreach (self::FILES as $f) {
                    $zip->addFile(self::file($deck, $format, $cards, $f), $f);
                }
                $zip->close();
                rename("$path.part", $path);
                break;
            default:
                throw new InvalidArgumentException('Fichier inconnu.');
        }
        return $path;
    }

    /** [cb_kits] : boutons de téléchargement des kits, par jeu et par format (page « Guide »). */
    public static function shortcode(): string
    {
        $rows = [];
        foreach (get_posts(['post_type' => 'product', 'numberposts' => -1, 'meta_key' => '_cb_deck', 'orderby' => 'menu_order', 'order' => 'ASC']) as $p) {
            $deck = CB_Settings::deck((string) get_post_meta($p->ID, '_cb_deck', true));
            if (!$deck) {
                continue;
            }
            foreach ($deck['formats'] as $f) {
                $url = add_query_arg(['product_id' => $p->ID, 'format' => $f], rest_url('cb/v1/kit'));
                $rows[] = sprintf('<li><a class="wp-element-button" href="%s">%s · %s</a></li>', esc_url($url), esc_html(get_the_title($p)), esc_html(CB_Settings::FORMATS[$f]['label']));
            }
        }
        return $rows ? '<ul class="cb-kits">' . implode('', $rows) . '</ul>' : '';
    }
}
