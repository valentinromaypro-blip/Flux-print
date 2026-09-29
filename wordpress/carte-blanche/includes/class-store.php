<?php
/**
 * Stockage : tables des travaux (un jeu à fabriquer) et des lots SRA3, fichiers privés.
 *
 * Les fichiers sont dans wp-content/uploads/carte-blanche/, dossier interdit en accès direct
 * (.htaccess) : ils ne sortent que par l'API du plugin, pour leur propriétaire ou l'atelier.
 */

defined('ABSPATH') || exit;

final class CB_Store
{
    public static function jobs(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'cb_jobs';
    }

    public static function lots(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'cb_lots';
    }

    public static function install(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        // Statuts d'un travail : draft → uploaded → checking → approved | rejected | failed
        //                        → paid (commande payée) → lotted (dans un lot) → printed
        dbDelta('CREATE TABLE ' . self::jobs() . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uid char(32) NOT NULL,
            session char(64) NOT NULL,
            product_id bigint(20) unsigned NOT NULL,
            kind varchar(16) NOT NULL DEFAULT 'design',
            deck varchar(8) NOT NULL DEFAULT '54',
            media varchar(40) NOT NULL DEFAULT 'cmdm-350g',
            status varchar(16) NOT NULL DEFAULT 'draft',
            design longtext NULL,
            report longtext NULL,
            error text NULL,
            order_id bigint(20) unsigned NULL,
            order_item_id bigint(20) unsigned NULL,
            copies int(11) NOT NULL DEFAULT 1,
            lot_id varchar(40) NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            paid_at datetime NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uid (uid),
            KEY status (status),
            KEY order_id (order_id)
        ) $charset;");
        dbDelta('CREATE TABLE ' . self::lots() . " (
            id varchar(40) NOT NULL,
            status varchar(16) NOT NULL DEFAULT 'planned',
            media varchar(40) NOT NULL,
            reason varchar(120) NULL,
            sheets int(11) NULL,
            decks int(11) NULL,
            manifest longtext NULL,
            error text NULL,
            created_at datetime NOT NULL,
            generated_at datetime NULL,
            printed_at datetime NULL,
            PRIMARY KEY  (id),
            KEY status (status)
        ) $charset;");
        self::dir('');
        update_option('cb_db_version', CB_VERSION);
    }

    /** Dossier privé (créé à la demande, protégé contre l'accès direct). */
    public static function dir(string $sub): string
    {
        $base = wp_upload_dir()['basedir'] . '/carte-blanche';
        if (!is_dir($base)) {
            wp_mkdir_p($base);
            file_put_contents("$base/.htaccess", "Require all denied\nDeny from all\n");
            file_put_contents("$base/index.php", "<?php // Silence.\n");
        }
        $path = rtrim("$base/$sub", '/');
        if (!is_dir($path)) {
            wp_mkdir_p($path);
        }
        return $path;
    }

    public static function job_dir(string $uid): string
    {
        return self::dir('jobs/' . preg_replace('/[^a-f0-9]/', '', $uid));
    }

    public static function now(): string
    {
        return current_time('mysql', true);
    }

    public static function job(string $uid): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::jobs() . ' WHERE uid = %s', $uid), ARRAY_A);
        return $row ? self::decode($row) : null;
    }

    public static function job_by_id(int $id): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::jobs() . ' WHERE id = %d', $id), ARRAY_A);
        return $row ? self::decode($row) : null;
    }

    /** @return array<int, array> */
    public static function jobs_where(string $sql, array $args = []): array
    {
        global $wpdb;
        $query = 'SELECT * FROM ' . self::jobs() . " WHERE $sql";
        $rows = $wpdb->get_results($args ? $wpdb->prepare($query, $args) : $query, ARRAY_A) ?: [];
        return array_map([self::class, 'decode'], $rows);
    }

    private static function decode(array $row): array
    {
        foreach (['design', 'report'] as $k) {
            $row[$k] = $row[$k] ? json_decode($row[$k], true) : null;
        }
        return $row;
    }

    public static function create_job(array $fields): array
    {
        global $wpdb;
        $now = self::now();
        $row = $fields + ['uid' => bin2hex(random_bytes(16)), 'created_at' => $now, 'updated_at' => $now];
        $wpdb->insert(self::jobs(), $row);
        return self::job($row['uid']);
    }

    public static function update_job(string $uid, array $fields): void
    {
        global $wpdb;
        foreach (['design', 'report'] as $k) {
            if (array_key_exists($k, $fields) && is_array($fields[$k])) {
                $fields[$k] = wp_json_encode($fields[$k]);
            }
        }
        $fields['updated_at'] = self::now();
        $wpdb->update(self::jobs(), $fields, ['uid' => $uid]);
    }

    public static function lot(string $id): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::lots() . ' WHERE id = %s', $id), ARRAY_A);
        if ($row) {
            $row['manifest'] = $row['manifest'] ? json_decode($row['manifest'], true) : null;
        }
        return $row;
    }

    /** Journal lisible dans les notes de commande WooCommerce. */
    public static function note(?int $order_id, string $text): void
    {
        if ($order_id && ($order = wc_get_order($order_id))) {
            $order->add_order_note($text);
        }
    }
}
