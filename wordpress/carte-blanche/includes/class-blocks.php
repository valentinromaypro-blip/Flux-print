<?php
/**
 * Blocs WordPress natifs (Gutenberg), écrits exactement comme l'éditeur les enregistre :
 * les pages créées par la mise en place s'ouvrent et se modifient normalement dans l'éditeur.
 */

defined('ABSPATH') || exit;

final class CB_Blocks
{
    private static function block(string $name, array $attrs, string $html): string
    {
        $json = $attrs ? ' ' . wp_json_encode($attrs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : '';
        return "<!-- wp:$name$json -->\n$html\n<!-- /wp:$name -->";
    }

    public static function join(array $blocks): string
    {
        return implode("\n\n", array_filter($blocks));
    }

    /** Paragraphe ; $html peut contenir des liens et du gras. */
    public static function p(string $html, bool $center = false, bool $lead = false): string
    {
        $attrs = [];
        $class = [];
        if ($center) {
            $attrs['align'] = 'center';
            $class[] = 'has-text-align-center';
        }
        if ($lead) {
            $attrs['fontSize'] = 'large';
            $class[] = 'has-large-font-size';
        }
        $c = $class ? ' class="' . implode(' ', $class) . '"' : '';
        return self::block('paragraph', $attrs, "<p$c>$html</p>");
    }

    public static function h(string $text, int $level = 2, bool $center = false, bool $wide = false): string
    {
        $attrs = $level !== 2 ? ['level' => $level] : [];
        $class = 'wp-block-heading';
        if ($wide) {
            $attrs['align'] = 'wide';
            $class .= ' alignwide';
        }
        if ($center) {
            $attrs['textAlign'] = 'center';
            $class .= ' has-text-align-center';
        }
        return self::block('heading', $attrs, "<h$level class=\"$class\">$text</h$level>");
    }

    public static function ul(array $items): string
    {
        $li = implode('', array_map(fn($i) => self::block('list-item', [], "<li>$i</li>"), $items));
        return self::block('list', [], "<ul class=\"wp-block-list\">$li</ul>");
    }

    public static function ol(array $items): string
    {
        $li = implode('', array_map(fn($i) => self::block('list-item', [], "<li>$i</li>"), $items));
        return self::block('list', ['ordered' => true], "<ol class=\"wp-block-list\">$li</ol>");
    }

    /** @param array<int, array{0:string,1:string,2?:bool}> $buttons libellé, adresse, secondaire */
    public static function buttons(array $buttons, bool $center = false): string
    {
        $inner = implode('', array_map(function ($b) {
            $outline = !empty($b[2]);
            $html = '<div class="wp-block-button' . ($outline ? ' is-style-outline' : '') . '"><a class="wp-block-button__link wp-element-button" href="' . esc_url($b[1]) . '">' . esc_html($b[0]) . '</a></div>';
            return self::block('button', $outline ? ['className' => 'is-style-outline'] : [], $html);
        }, $buttons));
        $attrs = $center ? ['layout' => ['type' => 'flex', 'justifyContent' => 'center']] : [];
        return self::block('buttons', $attrs, "<div class=\"wp-block-buttons\">$inner</div>");
    }

    /** @param array<int, string[]> $columns blocs de chaque colonne */
    public static function columns(array $columns, bool $middle = false, bool $wide = true): string
    {
        $inner = implode('', array_map(function ($blocks) use ($middle) {
            return self::block('column', $middle ? ['verticalAlignment' => 'center'] : [],
                '<div class="wp-block-column' . ($middle ? ' is-vertically-aligned-center' : '') . '">' . self::join($blocks) . '</div>');
        }, $columns));
        $attrs = ($middle ? ['verticalAlignment' => 'center'] : []) + ($wide ? ['align' => 'wide'] : []);
        $class = 'wp-block-columns' . ($wide ? ' alignwide' : '') . ($middle ? ' are-vertically-aligned-center' : '');
        return self::block('columns', $attrs, "<div class=\"$class\">$inner</div>");
    }

    /** Image de la médiathèque ; rien si l'image n'existe pas. */
    public static function image(?int $id, string $alt): string
    {
        $url = $id ? wp_get_attachment_image_url($id, 'large') : null;
        if (!$url) {
            return '';
        }
        return self::block('image', ['id' => $id, 'sizeSlug' => 'large', 'linkDestination' => 'none'],
            '<figure class="wp-block-image size-large"><img src="' . esc_url($url) . '" alt="' . esc_attr($alt) . "\" class=\"wp-image-$id\"/></figure>");
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
