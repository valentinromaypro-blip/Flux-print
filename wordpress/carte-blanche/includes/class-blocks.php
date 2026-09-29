<?php
/**
 * Blocs WordPress natifs (Gutenberg), écrits exactement comme l'éditeur les enregistre :
 * les pages créées par la mise en place s'ouvrent et se modifient normalement dans l'éditeur.
 * Les classes « cb-… » sont mises en forme par le thème Carte Blanche (et restent neutres ailleurs).
 */

defined('ABSPATH') || exit;

final class CB_Blocks
{
    private static function block(string $name, array $attrs, string $html): string
    {
        $json = $attrs ? ' ' . wp_json_encode($attrs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : '';
        return "<!-- wp:$name$json -->\n$html\n<!-- /wp:$name -->";
    }

    /** Classe CSS personnalisée : attribut className + classe dans le HTML. */
    private static function cls(array &$attrs, array &$classes, string $class): void
    {
        if ($class !== '') {
            $attrs['className'] = $class;
            $classes[] = $class;
        }
    }

    private static function class_attr(array $classes): string
    {
        return $classes ? ' class="' . implode(' ', $classes) . '"' : '';
    }

    public static function join(array $blocks): string
    {
        return implode("\n\n", array_filter($blocks));
    }

    /** Paragraphe ; $html peut contenir des liens et du gras. */
    public static function p(string $html, bool $center = false, bool $lead = false, string $class = ''): string
    {
        $attrs = [];
        $classes = [];
        if ($center) {
            $attrs['align'] = 'center';
            $classes[] = 'has-text-align-center';
        }
        self::cls($attrs, $classes, $class);
        if ($lead) {
            $attrs['fontSize'] = 'large';
            $classes[] = 'has-large-font-size';
        }
        return self::block('paragraph', $attrs, '<p' . self::class_attr($classes) . ">$html</p>");
    }

    public static function h(string $text, int $level = 2, bool $center = false, bool $wide = false, string $class = ''): string
    {
        $attrs = $level !== 2 ? ['level' => $level] : [];
        $classes = ['wp-block-heading'];
        if ($center) {
            $attrs['textAlign'] = 'center';
            $classes[] = 'has-text-align-center';
        }
        if ($wide) {
            $attrs['align'] = 'wide';
            $classes[] = 'alignwide';
        }
        self::cls($attrs, $classes, $class);
        return self::block('heading', $attrs, "<h$level" . self::class_attr($classes) . ">$text</h$level>");
    }

    public static function ul(array $items, string $class = ''): string
    {
        $attrs = [];
        $classes = ['wp-block-list'];
        self::cls($attrs, $classes, $class);
        $li = implode('', array_map(fn($i) => self::block('list-item', [], "<li>$i</li>"), $items));
        return self::block('list', $attrs, '<ul' . self::class_attr($classes) . ">$li</ul>");
    }

    public static function ol(array $items): string
    {
        $li = implode('', array_map(fn($i) => self::block('list-item', [], "<li>$i</li>"), $items));
        return self::block('list', ['ordered' => true], "<ol class=\"wp-block-list\">$li</ol>");
    }

    /**
     * @param array<int, array{0:string,1:string,2?:bool|string}> $buttons libellé, adresse, style
     *        (true ou 'outline' : secondaire ; 'red', 'light' : styles du thème)
     */
    public static function buttons(array $buttons, bool $center = false): string
    {
        $inner = implode('', array_map(function ($b) {
            $style = ($b[2] ?? false) === true ? 'outline' : ($b[2] ?? '');
            $class = $style ? "is-style-$style" : '';
            $html = '<div class="wp-block-button' . ($class ? " $class" : '') . '"><a class="wp-block-button__link wp-element-button" href="' . esc_url($b[1]) . '">' . esc_html($b[0]) . '</a></div>';
            return self::block('button', $class ? ['className' => $class] : [], $html);
        }, $buttons));
        $attrs = $center ? ['layout' => ['type' => 'flex', 'justifyContent' => 'center']] : [];
        return self::block('buttons', $attrs, "<div class=\"wp-block-buttons\">$inner</div>");
    }

    /** @param array<int, string[]> $columns blocs de chaque colonne */
    public static function columns(array $columns, bool $middle = false, bool $wide = true, string $class = '', array $widths = []): string
    {
        $inner = implode('', array_map(function ($blocks, $i) use ($middle, $widths) {
            $attrs = $middle ? ['verticalAlignment' => 'center'] : [];
            $style = '';
            if (isset($widths[$i])) {
                $attrs['width'] = $widths[$i];
                $style = " style=\"flex-basis:{$widths[$i]}\"";
            }
            return self::block('column', $attrs,
                '<div class="wp-block-column' . ($middle ? ' is-vertically-aligned-center' : '') . "\"$style>" . self::join($blocks) . '</div>');
        }, $columns, array_keys($columns)));
        $attrs = ($middle ? ['verticalAlignment' => 'center'] : []) + ($wide ? ['align' => 'wide'] : []);
        $classes = ['wp-block-columns'];
        if ($wide) {
            $classes[] = 'alignwide';
        }
        if ($middle) {
            $classes[] = 'are-vertically-aligned-center';
        }
        self::cls($attrs, $classes, $class);
        return self::block('columns', $attrs, '<div' . self::class_attr($classes) . ">$inner</div>");
    }

    /** Image de la médiathèque ; rien si l'image n'existe pas. */
    public static function image(?int $id, string $alt, string $link = '', string $caption = '', string $class = ''): string
    {
        $url = $id ? wp_get_attachment_image_url($id, 'large') : null;
        if (!$url) {
            return '';
        }
        $attrs = ['id' => $id, 'sizeSlug' => 'large', 'linkDestination' => $link ? 'custom' : 'none'];
        $classes = ['wp-block-image', 'size-large'];
        self::cls($attrs, $classes, $class);
        $img = '<img src="' . esc_url($url) . '" alt="' . esc_attr($alt) . "\" class=\"wp-image-$id\"/>";
        if ($link) {
            $img = '<a href="' . esc_url($link) . "\">$img</a>";
        }
        $cap = $caption ? "<figcaption class=\"wp-element-caption\">$caption</figcaption>" : '';
        return self::block('image', $attrs, '<figure' . self::class_attr($classes) . ">$img$cap</figure>");
    }

    /** Question dépliable (FAQ). */
    public static function details(string $question, string $answer_html): string
    {
        return self::block('details', [], '<details class="wp-block-details"><summary>' . $question . '</summary>' . self::p($answer_html) . '</details>');
    }

    /** Section : fond coloré optionnel, pleine largeur, contenu centré. */
    public static function section(array $blocks, ?string $background = null): string
    {
        $attrs = ['align' => 'full', 'style' => ['spacing' => ['padding' => ['top' => '56px', 'bottom' => '56px', 'left' => '24px', 'right' => '24px']]], 'layout' => ['type' => 'constrained']];
        $style = 'padding-top:56px;padding-right:24px;padding-bottom:56px;padding-left:24px';
        $class = 'wp-block-group alignfull';
        if ($background) {
            $attrs['style']['color'] = ['background' => $background];
            $style = "background-color:$background;$style";
            $class .= ' has-background';
        }
        return self::block('group', $attrs, "<div class=\"$class\" style=\"$style\">" . self::join($blocks) . '</div>');
    }

    /**
     * Bloc groupe large, avec couleurs du thème (slugs de la palette) et marge intérieure.
     * $layout : constrained (contenu centré) ou flow.
     */
    public static function group(array $blocks, string $class = '', ?string $bg = null, ?string $text = null, string $padding = '', string $layout = 'constrained', string $align = 'wide'): string
    {
        $attrs = [];
        $classes = ['wp-block-group'];
        if ($align) {
            $attrs['align'] = $align;
            $classes[] = "align$align";
        }
        self::cls($attrs, $classes, $class);
        if ($bg) {
            $attrs['backgroundColor'] = $bg;
            $classes[] = "has-$bg-background-color";
        }
        if ($text) {
            $attrs['textColor'] = $text;
            $classes[] = "has-$text-color";
            $classes[] = 'has-text-color';
        }
        if ($bg) {
            $classes[] = 'has-background';
        }
        $style = '';
        if ($padding) {
            $attrs['style'] = ['spacing' => ['padding' => ['top' => $padding, 'bottom' => $padding, 'left' => $padding, 'right' => $padding]]];
            $style = " style=\"padding-top:$padding;padding-right:$padding;padding-bottom:$padding;padding-left:$padding\"";
        }
        $attrs['layout'] = ['type' => $layout];
        return self::block('group', $attrs, '<div' . self::class_attr($classes) . "$style>" . self::join($blocks) . '</div>');
    }

    /** @param array<int, array{0:string,1:string}> $rows */
    public static function table(array $rows): string
    {
        $tr = implode('', array_map(fn($r) => "<tr><td>{$r[0]}</td><td>{$r[1]}</td></tr>", $rows));
        return self::block('table', [], "<figure class=\"wp-block-table\"><table class=\"has-fixed-layout\"><tbody>$tr</tbody></table></figure>");
    }

    public static function shortcode(string $code): string
    {
        return self::block('shortcode', [], $code);
    }

    /** Champ à compléter par l'atelier, surligné dans l'éditeur et repéré par la mise en place. */
    public static function todo(string $what): string
    {
        return '<mark style="background-color:#FFE58F" class="has-inline-color">[à compléter : ' . $what . ']</mark>';
    }
}
