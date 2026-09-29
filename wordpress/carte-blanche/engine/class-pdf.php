<?php
/**
 * Écriture d'un PDF d'impression, en flux, sans bibliothèque externe.
 *
 * Pensé pour un hébergement mutualisé : les images JPEG CMJN sont recopiées du disque vers le PDF
 * par blocs (jamais chargées entières en mémoire), et chaque image n'est incorporée qu'une fois
 * (un dos commun posé 54 fois, une face standard partagée par plusieurs jeux).
 *
 * Convention CMJN : les JPEG CMJN portant le marqueur Adobe (ImageMagick, Photoshop) stockent des
 * valeurs inversées ; on le déclare avec /Decode, sinon le cyan sortirait rouge à la presse
 * (vérifié avec Ghostscript : lecture identique aux valeurs converties en PSO Coated v3).
 */

defined('ABSPATH') || exit;

final class CB_Pdf
{
    /** @var resource */
    private $fh;
    private array $offsets = [];
    private int $next = 4; // 1 : catalogue, 2 : arbre des pages, 3 : police
    private array $pages = [];
    private array $images = [];

    public function __construct(private string $path)
    {
        $this->fh = fopen($path, 'wb');
        if (!$this->fh) {
            throw new RuntimeException("Écriture impossible : $path");
        }
        fwrite($this->fh, "%PDF-1.6\n%\xE2\xE3\xCF\xD3\n");
        // Police standard (Helvetica) pour les repères et les cartes d'identification
        $this->write_obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    }

    public static function mm(float $mm): float
    {
        return $mm / 25.4 * 72;
    }

    /** Texte PDF (WinAnsi) échappé. */
    public static function text(string $s): string
    {
        $s = function_exists('iconv') ? (string) @iconv('UTF-8', 'CP1252//TRANSLIT', $s) : $s;
        return '(' . strtr($s, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)']) . ')';
    }

    private function write_obj(int $id, string $body): void
    {
        $this->offsets[$id] = ftell($this->fh);
        fwrite($this->fh, "$id 0 obj\n$body\nendobj\n");
    }

    private function stream_obj(string $dict, string $data): int
    {
        $id = $this->next++;
        $data = gzcompress($data, 6);
        $this->write_obj($id, "<< $dict /Filter /FlateDecode /Length " . strlen($data) . " >>\nstream\n$data\nendstream");
        return $id;
    }

    /** Image JPEG (CMJN ou RVB) : identifiant de l'objet, incorporé une seule fois par fichier. */
    public function image(string $file): int
    {
        if (isset($this->images[$file])) {
            return $this->images[$file];
        }
        $info = @getimagesize($file);
        if (!$info || $info[2] !== IMAGETYPE_JPEG) {
            throw new RuntimeException('Image d’impression illisible : ' . basename($file));
        }
        $size = filesize($file);
        $in = fopen($file, 'rb');
        $head = fread($in, 4096);
        rewind($in);
        $cmyk = ($info['channels'] ?? 3) === 4;
        $space = $cmyk ? '/DeviceCMYK' : '/DeviceRGB';
        $decode = $cmyk && str_contains($head, "\xFF\xEE") && str_contains($head, 'Adobe') ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
        $id = $this->next++;
        $this->offsets[$id] = ftell($this->fh);
        fwrite($this->fh, "$id 0 obj\n<< /Type /XObject /Subtype /Image /Width {$info[0]} /Height {$info[1]} /ColorSpace $space"
            . " /BitsPerComponent 8 /Filter /DCTDecode$decode /Length $size >>\nstream\n");
        stream_copy_to_stream($in, $this->fh);
        fclose($in);
        fwrite($this->fh, "\nendstream\nendobj\n");
        return $this->images[$file] = $id;
    }

    /** Dessin vectoriel réutilisable (carte d'identification), en points, origine en bas à gauche. */
    public function form(string $content, float $w, float $h): int
    {
        return $this->stream_obj(sprintf('/Type /XObject /Subtype /Form /BBox [0 0 %.3F %.3F] /Resources << /Font << /F1 3 0 R >> >>', $w, $h), $content);
    }

    /** Page : contenu et objets (images, dessins) qu'il utilise, nommés /X<id>. */
    public function page(string $content, array $xobjects, float $w, float $h): void
    {
        $content_id = $this->stream_obj('', $content);
        $xo = implode(' ', array_map(fn($id) => "/X$id $id 0 R", array_unique($xobjects)));
        $id = $this->next++;
        $this->write_obj($id, sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3F %.3F] /Resources << /Font << /F1 3 0 R >> /XObject << %s >> >> /Contents %d 0 R >>',
            $w, $h, $xo, $content_id));
        $this->pages[] = $id;
    }

    public function close(string $title): void
    {
        $this->write_obj(2, '<< /Type /Pages /Kids [' . implode(' ', array_map(fn($i) => "$i 0 R", $this->pages)) . '] /Count ' . count($this->pages) . ' >>');
        $this->write_obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        $info = $this->next++;
        $this->write_obj($info, '<< /Title ' . self::text($title) . ' /Producer (Carte Blanche) /CreationDate (D:' . gmdate('YmdHis') . 'Z) >>');
        $xref = ftell($this->fh);
        $count = $this->next;
        $out = "xref\n0 $count\n0000000000 65535 f \n";
        for ($i = 1; $i < $count; $i++) {
            $out .= sprintf("%010d 00000 n \n", $this->offsets[$i] ?? 0);
        }
        fwrite($this->fh, $out . "trailer\n<< /Size $count /Root 1 0 R /Info $info 0 R >>\nstartxref\n$xref\n%%EOF\n");
        fclose($this->fh);
    }

    /**
     * Matrice (opérateur cm) qui pose un contenu dans le rectangle (x, y, w, h) de la feuille, pivoté
     * de `rot` degrés dans le sens anti-horaire. w × h : le rectangle occupé sur la feuille ; le
     * contenu mesure h × w s'il est pivoté d'un quart de tour. $unit : true pour une image (espace
     * unitaire 1 × 1), false pour un dessin en points.
     */
    public static function place(float $x, float $y, float $w, float $h, int $rot, bool $unit): string
    {
        $rot = (($rot % 360) + 360) % 360;
        [$cw, $ch] = $rot % 180 ? [$h, $w] : [$w, $h];
        [$sx, $sy] = $unit ? [$cw, $ch] : [1.0, 1.0];
        $m = match ($rot) {
            90 => [0, $sx, -$sy, 0, $x + $ch, $y],
            180 => [-$sx, 0, 0, -$sy, $x + $cw, $y + $ch],
            270 => [0, -$sx, $sy, 0, $x, $y + $cw],
            default => [$sx, 0, 0, $sy, $x, $y],
        };
        return vsprintf('%.4F %.4F %.4F %.4F %.4F %.4F cm', $m);
    }
}
