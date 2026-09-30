<?php
/** Administration : menu « Carte Blanche » (diagnostic de l'hébergement, puis atelier). */

defined('ABSPATH') || exit;

final class CB_Admin
{
    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'menu']);
        add_action('admin_post_cb_setup', [self::class, 'run_setup']);
        add_action('admin_post_cb_prod', [self::class, 'production_action']);
    }

    public static function menu(): void
    {
        add_menu_page('Carte Blanche', 'Carte Blanche', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic'], 'dashicons-images-alt2', 56);
        add_submenu_page('carte-blanche', 'Diagnostic', 'Diagnostic', 'manage_woocommerce', 'carte-blanche', [self::class, 'diagnostic']);
        add_submenu_page('carte-blanche', 'Production', 'Production', 'manage_woocommerce', 'carte-blanche-production', [self::class, 'production']);
        add_submenu_page('carte-blanche', 'Mise en place du site', 'Mise en place', 'manage_options', 'carte-blanche-setup', [self::class, 'setup']);
    }

    /** @return array<int, array{0:string,1:bool,2:string,3:string}> libellé, ok, valeur, conseil */
    public static function checks(): array
    {
        $bytes = fn($v) => (int) wp_convert_hr_to_bytes((string) $v);
        $imagick = extension_loaded('imagick') ? (Imagick::getVersion()['versionString'] ?? 'oui') : null;
        $gs = CB_Check::gs();
        $gs_version = $gs ? trim((string) @shell_exec(escapeshellarg($gs) . ' --version 2>/dev/null')) : null;
        $uploads = CB_Store::dir('');
        $mem = ini_get('memory_limit');
        return [
            ['PHP 8.1 ou plus', version_compare(PHP_VERSION, '8.1', '>='), PHP_VERSION, 'Espace client OVH → Hébergement → Version PHP globale : 8.2'],
            ['Imagick (images, profils couleur)', (bool) $imagick, $imagick ?: 'absent', 'OVH : environnement d’exécution « stable64 » (Configuration globale)'],
            ['Ghostscript (lecture des PDF)', (bool) $gs, $gs_version ? "gs $gs_version" : 'absent ou exec() désactivé', 'Nécessaire pour les PDF déposés par les clients'],
            ['Mémoire PHP ≥ 256 Mo', $mem === '-1' || $bytes($mem) >= 256 * 1048576, (string) $mem, 'OVH : activer le moteur PHP-FPM (512 Mo)'],
            ['Temps d’exécution ≥ 120 s', (int) ini_get('max_execution_time') === 0 || (int) ini_get('max_execution_time') >= 120, ini_get('max_execution_time') . ' s', 'OVH : moteur PHP-FPM (165 s)'],
            ['Taille d’envoi ≥ 8 Mo', $bytes(ini_get('upload_max_filesize')) >= 8 * 1048576 && $bytes(ini_get('post_max_size')) >= 8 * 1048576,
                ini_get('upload_max_filesize') . ' / ' . ini_get('post_max_size'), 'Les gros PDF sont envoyés par morceaux de 4 Mo'],
            ['Dossier privé des fichiers', is_writable($uploads), str_replace(ABSPATH, '', $uploads), 'Droits d’écriture sur wp-content/uploads'],
            ['WooCommerce', class_exists('WooCommerce'), defined('WC_VERSION') ? WC_VERSION : 'absent', 'Activer WooCommerce sur ce site'],
            ['Détourage des visages', CB_Segmenter::ready(), CB_Segmenter::ready() ? 'installé' : ((string) get_option('cb_segmenter_error') ?: 'installation en cours (tâche de fond)'),
                'Le serveur télécharge 27 Mo depuis jsDelivr/Google : bouton « Traiter maintenant » de la page Production, ou recharger cette page plus tard. En attendant, les visages sont en ovale.'],
            ['Tâches de fond (Action Scheduler)', function_exists('as_enqueue_async_action'), function_exists('as_enqueue_async_action') ? 'oui' : 'non', 'Fourni par WooCommerce'],
        ];
    }

    public static function diagnostic(): void
    {
        echo '<div class="wrap"><h1>Carte Blanche · Diagnostic de l’hébergement</h1>';
        echo '<p>Ce que le plugin peut faire sur ce serveur. Tout doit être vert avant d’ouvrir la vente.</p>';
        echo '<table class="widefat striped" style="max-width:960px"><thead><tr><th>Élément</th><th>État</th><th>Valeur</th><th>Si ce n’est pas bon</th></tr></thead><tbody>';
        foreach (self::checks() as [$label, $ok, $value, $hint]) {
            printf('<tr><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s</td></tr>', esc_html($label),
                $ok ? '<span style="color:#1e7a4f;font-weight:600">✔ OK</span>' : '<span style="color:#c4172c;font-weight:600">✘ À corriger</span>',
                esc_html($value), $ok ? '' : esc_html($hint));
        }
        echo '</tbody></table>';
        self::shop_checks();
        $products = get_posts(['post_type' => 'product', 'meta_key' => '_cb_deck', 'meta_compare' => '!=', 'meta_value' => '', 'numberposts' => 20]);
        echo '<h2>Produits avec le studio</h2>';
        if (!$products) {
            echo '<p>Aucun pour l’instant : ouvrez un produit WooCommerce → onglet Général → « Studio Carte Blanche ».</p>';
        } else {
            echo '<ul>' . implode('', array_map(fn($p) => '<li><a href="' . esc_url(get_permalink($p)) . '">' . esc_html($p->post_title) . '</a></li>', $products)) . '</ul>';
        }
        echo '</div>';
    }

    public static function run_setup(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('Accès refusé.');
        }
        check_admin_referer('cb_setup');
        @set_time_limit(120);
        set_transient('cb_setup_log_' . get_current_user_id(), CB_Setup::run(), 600);
        wp_safe_redirect(admin_url('admin.php?page=carte-blanche-setup&done=1'));
        exit;
    }

    public static function setup(): void
    {
        $state = CB_Setup::state();
        $log = get_transient('cb_setup_log_' . get_current_user_id());
        $edit = fn($id) => $id ? ' · <a href="' . esc_url(get_edit_post_link($id)) . '">modifier</a> · <a href="' . esc_url(get_permalink($id)) . '">voir</a>' : '';
        echo '<div class="wrap"><h1>Carte Blanche · Mise en place du site</h1>';
        echo '<p style="max-width:760px">Crée en un clic la structure du site : les pages rédigées pour le référencement (en blocs, modifiables dans l’éditeur), les deux jeux personnalisables, les menus, la page d’accueil et les réglages WooCommerce (euro, TVA, CGV).<br>'
            . '<strong>Rien n’est écrasé</strong> : une page ou un produit qui existe déjà à la même adresse est laissé tel quel. Vous pouvez relancer sans créer de doublons.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('cb_setup');
        echo '<input type="hidden" name="action" value="cb_setup">';
        submit_button($state['done_at'] ? 'Relancer la mise en place (compléter ce qui manque)' : 'Installer la structure du site', 'primary large', 'submit', false);
        echo '</form>';

        if ($log && isset($_GET['done'])) {
            echo '<h2>Ce qui vient d’être fait</h2><table class="widefat striped" style="max-width:960px"><tbody>';
            foreach ($log as [$status, $what, $id]) {
                $color = ['créé' => '#1e7a4f', 'mis à jour' => '#1e7a4f', 'réglé' => '#2271b1', 'existant' => '#646970', 'ignoré' => '#c4172c'][$status] ?? '#000';
                printf('<tr><td style="width:90px;color:%s;font-weight:600">%s</td><td>%s%s</td></tr>', $color, esc_html($status), esc_html($what), $edit($id));
            }
            echo '</tbody></table>';
        }

        if ($state['done_at']) {
            $todos = CB_Setup::todos();
            echo '<h2>À compléter</h2>';
            if (!$todos) {
                echo '<p>✔ Plus aucun champ « [à compléter] » dans les pages.</p>';
            } else {
                echo '<p>Les passages surlignés en jaune <mark style="background:#FFE58F">[à compléter : …]</mark> attendent vos informations (délais, SIRET, contact…).</p><ul>';
                foreach ($todos as [$id, $title, $n]) {
                    echo '<li><strong>' . esc_html($title) . "</strong> : $n champ" . ($n > 1 ? 's' : '') . $edit($id) . '</li>';
                }
                echo '</ul>';
            }
            $public = (bool) get_option('blog_public');
            $soon = get_option('woocommerce_coming_soon') === 'yes';
            $seo = defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION');
            echo '<h2>Et ensuite</h2><ol style="max-width:760px">';
            echo '<li>Remplacer les illustrations par <strong>vos photos</strong> de jeux imprimés (dans chaque page : cliquer l’image → Remplacer ; pour un produit : Image produit).</li>';
            echo '<li>Vérifier les <strong>prix</strong> des deux jeux (Produits).</li>';
            echo '<li><strong>Paiement</strong> : extension « WooCommerce Stripe Payment Gateway ». <strong>Livraison</strong> : WooCommerce → Réglages → Expédition.</li>';
            echo '<li><strong>Référencement</strong> : ' . ($seo ? '✔ extension SEO active' : 'installer <strong>Rank Math</strong> ou <strong>Yoast SEO</strong> (les titres et descriptions sont déjà prêts, ils seront repris)') . '.</li>';
            echo '<li><strong>Visibilité</strong> : ' . ($public ? '⚠ le site est ouvert aux moteurs de recherche' : '✔ le site est masqué aux moteurs de recherche pendant la construction (Réglages → Lecture)')
                . ($soon ? ' · mode « Bientôt disponible » de WooCommerce actif (visiteurs bloqués, vous voyez le site car vous êtes connecté)' : '') . '.</li>';
            echo '<li>Le jour du lancement, sur le domaine définitif : ouvrir aux moteurs, puis déclarer le site dans <strong>Google Search Console</strong> et <strong>Google Merchant Center</strong>.</li>';
            echo '</ol>';
        }
        echo '</div>';
    }

    /** Boutique : ce qui fait perdre le panier entre deux pages (adresses, cookies, cache). */
    private static function shop_checks(): void
    {
        $home = home_url('/');
        $parts = fn($u) => [(string) wp_parse_url($u, PHP_URL_SCHEME), (string) wp_parse_url($u, PHP_URL_HOST)];
        [$hs, $hh] = $parts($home);
        [$ss, $sh] = $parts(site_url('/'));
        $cart = function_exists('wc_get_cart_url') ? wc_get_cart_url() : '';
        $checkout = function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : '';
        $same = fn($u) => $u && $parts($u) === [$hs, $hh];
        $checkout_id = function_exists('wc_get_page_id') ? wc_get_page_id('checkout') : 0;
        $checkout_post = $checkout_id > 0 ? get_post($checkout_id) : null;
        $has_checkout = $checkout_post && (has_block('woocommerce/checkout', $checkout_post) || has_shortcode($checkout_post->post_content, 'woocommerce_checkout'));
        $plugins = array_merge(array_keys((array) get_site_option('active_sitewide_plugins', [])), (array) get_option('active_plugins', []));
        $caches = array_values(array_filter($plugins, fn($p) => preg_match('/cache|rocket|speed|optimi|litespeed|autoptimize|hummingbird|swift/i', $p)));
        $rows = [
            ['Adresse du site = adresse WordPress', [$hs, $hh] === [$ss, $sh], home_url() . ' · ' . site_url(),
                'Admin du réseau → Sites → carteblanche → Modifier : les deux adresses doivent être identiques (même http/https, même nom).'],
            ['Page vue en ' . (is_ssl() ? 'https' : 'http') . ', site réglé en ' . $hs, (is_ssl() ? 'https' : 'http') === $hs, is_ssl() ? 'https' : 'http',
                $hs === 'https' ? 'Le site est réglé en https mais le certificat ne répond pas : repasser l’adresse en http:// tant que le cadenas n’apparaît pas.' : 'Ouvrir l’admin avec l’adresse du site.'],
            ['Panier sur la même adresse', $same($cart), $cart, 'WooCommerce → Réglages → Avancé : page Panier.'],
            ['Commande sur la même adresse', $same($checkout), $checkout, 'WooCommerce → Réglages → Avancé : page Validation de la commande.'],
            ['Page de commande valide', (bool) $has_checkout, $checkout_post ? $checkout_post->post_title . ' (#' . $checkout_id . ', ' . $checkout_post->post_status . ')' : 'absente',
                'WooCommerce → État → Outils → « Créer les pages par défaut ».'],
            ['Cookies', !defined('COOKIE_DOMAIN') || !COOKIE_DOMAIN || str_ends_with($hh, ltrim((string) COOKIE_DOMAIN, '.')),
                'COOKIE_DOMAIN=' . (defined('COOKIE_DOMAIN') ? var_export(COOKIE_DOMAIN, true) : 'non défini') . ' · COOKIEPATH=' . COOKIEPATH,
                'Dans wp-config.php, COOKIE_DOMAIN ne correspond pas à ce site.'],
            ['Cache de pages', !(defined('WP_CACHE') && WP_CACHE) && !$caches, (defined('WP_CACHE') && WP_CACHE ? 'WP_CACHE actif · ' : '') . ($caches ? implode(', ', $caches) : 'aucune extension de cache'),
                'Exclure du cache les pages Panier, Commande et Mon compte (ou désactiver le cache sur ce site).'],
        ];
        echo '<h2>Boutique : panier et commande</h2><table class="widefat striped" style="max-width:960px"><tbody>';
        foreach ($rows as [$label, $ok, $value, $hint]) {
            printf('<tr><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s</td></tr>', esc_html($label),
                $ok ? '<span style="color:#1e7a4f;font-weight:600">✔ OK</span>' : '<span style="color:#c4172c;font-weight:600">✘ À corriger</span>',
                esc_html($value), $ok ? '' : esc_html($hint));
        }
        echo '</tbody></table>';
        echo '<p style="max-width:960px">Extensions actives : <code>' . esc_html(implode(', ', array_map(fn($p) => dirname($p) === '.' ? $p : dirname($p), $plugins))) . '</code></p>';
    }

    // --- Production -------------------------------------------------------------------------------

    private static function prod_url(array $args = []): string
    {
        return admin_url('admin.php?page=carte-blanche-production' . ($args ? '&' . http_build_query($args) : ''));
    }

    private static function action_url(string $do, array $args = []): string
    {
        return wp_nonce_url(admin_url('admin-post.php?' . http_build_query(['action' => 'cb_prod', 'do' => $do] + $args)), 'cb_prod');
    }

    public static function production_action(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die('Accès refusé.');
        }
        check_admin_referer('cb_prod');
        $do = sanitize_key($_GET['do'] ?? '');
        $id = sanitize_text_field($_GET['lot'] ?? '');
        $msg = '';
        switch ($do) {
            case 'run':
                @set_time_limit(160);
                if (!CB_Segmenter::ready()) {
                    CB_Segmenter::install();
                }
                $r = CB_Production::run_now(110);
                $msg = sprintf('%d jeu(x) préparé(s), %d lot(s) créé(s).', $r['prepared'], count($r['lots']));
                break;
            case 'launch':
                $key = sanitize_text_field(wp_unslash($_GET['group'] ?? ''));
                @set_time_limit(160);
                $ids = CB_Production::plan_lots($key);
                foreach ($ids as $lot) {
                    CB_Production::build_lot($lot);
                }
                $msg = $ids ? 'Lot ' . implode(', ', $ids) . ' créé.' : 'Aucun jeu à lancer.';
                break;
            case 'retry':
                $uid = sanitize_key($_GET['job'] ?? '');
                if (($job = CB_Store::job($uid)) && $job['status'] === 'failed') {
                    CB_Store::update_job($uid, ['status' => 'paid', 'error' => null]);
                    CB_Production::job_paid($uid);
                    $msg = 'Préparation relancée.';
                }
                break;
            case 'rebuild':
                if (($lot = CB_Store::lot($id)) && $lot['status'] === 'failed') {
                    CB_Production::build_lot($id);
                    $msg = "Lot $id refait.";
                }
                break;
            case 'prices': // prix des options de conditionnement (par jeu, hors remise quantité)
                $all = get_option('cb_settings', []);
                foreach (['fenetre', 'custom'] as $p) {
                    $v = str_replace(',', '.', (string) wp_unslash($_POST["pack_price_$p"] ?? ''));
                    $all["pack_price_$p"] = is_numeric($v) ? max(0, round((float) $v, 2)) : CB_Box::PACKS[$p]['price'];
                }
                foreach (array_keys(CB_Box::PACKS) as $p) {
                    $all["pack_photo_$p"] = esc_url_raw(trim((string) wp_unslash($_POST["pack_photo_$p"] ?? '')));
                }
                update_option('cb_settings', $all);
                $msg = 'Conditionnement enregistré.';
                break;
            case 'printed':
                CB_Production::mark_printed($id);
                $msg = "Lot $id marqué imprimé.";
                break;
            case 'stock': // fichier d'impression de l'étui à fenêtre (stock)
                @set_time_limit(120);
                try {
                    $file = CB_Box::stock_pdf();
                } catch (Throwable $e) {
                    wp_die('Fabrication du fichier impossible : ' . esc_html($e->getMessage()));
                }
                nocache_headers();
                header('Content-Type: application/pdf');
                header('Content-Disposition: attachment; filename="' . basename($file) . '"');
                header('Content-Length: ' . filesize($file));
                while (ob_get_level()) {
                    ob_end_clean();
                }
                readfile($file);
                exit;
            case 'download':
                $file = ($_GET['file'] ?? '') === 'etuis' ? CB_Production::boxes_file($id) : CB_Production::lot_file($id);
                if (!is_file($file)) {
                    wp_die('Fichier introuvable.');
                }
                nocache_headers();
                header('Content-Type: application/pdf');
                header('Content-Disposition: attachment; filename="' . basename($file) . '"');
                header('Content-Length: ' . filesize($file));
                while (ob_get_level()) {
                    ob_end_clean();
                }
                readfile($file);
                exit;
        }
        wp_safe_redirect(self::prod_url($msg ? ['msg' => $msg] : []));
        exit;
    }

    public static function production(): void
    {
        if (!empty($_GET['lot'])) {
            self::lot_sheet(sanitize_text_field($_GET['lot']));
            return;
        }
        $media = fn($m) => CB_Settings::MEDIA[$m]['label'] ?? $m;
        $format = fn($f) => CB_Settings::FORMATS[$f]['label'] ?? $f;
        $order_link = function ($id) {
            $o = $id ? wc_get_order((int) $id) : null;
            return $o ? '<a href="' . esc_url($o->get_edit_order_url()) . '">#' . esc_html($o->get_order_number()) . '</a> ' . esc_html($o->get_formatted_billing_full_name()) : '—';
        };
        echo '<div class="wrap"><h1>Carte Blanche · Production</h1>';
        if (!empty($_GET['msg'])) {
            echo '<div class="notice notice-success"><p>' . esc_html(wp_unslash($_GET['msg'])) . '</p></div>';
        }
        echo '<p style="max-width:860px">Automatique : chaque jeu payé est préparé en CMJN (PSO Coated v3, 350 dpi), puis les jeux de même format et même carton partent en lot '
            . 'aux créneaux de <strong>' . implode(' et ', CB_Production::RULES['launch_times']) . '</strong> s’il y en a au moins ' . CB_Production::RULES['slot_min_decks']
            . ', tout de suite si un livre est plein, et au plus tard après ' . CB_Production::RULES['max_wait_hours'] . ' h. '
            . '<a class="button" href="' . esc_url(self::action_url('run')) . '">Traiter maintenant</a></p>';

        // Jeux en préparation ou en erreur
        $jobs = CB_Store::jobs_where("status IN ('paid', 'preparing', 'failed') AND order_id IS NOT NULL ORDER BY paid_at ASC");
        echo '<h2>En préparation</h2>';
        if (!$jobs) {
            echo '<p>Aucun jeu en préparation.</p>';
        } else {
            echo '<table class="widefat striped"><thead><tr><th>Commande</th><th>Jeu</th><th>Exemplaires</th><th>État</th><th></th></tr></thead><tbody>';
            foreach ($jobs as $j) {
                $state = ['paid' => 'en attente', 'preparing' => 'en cours', 'failed' => '<span style="color:#c4172c">erreur : ' . esc_html((string) $j['error']) . '</span>'][$j['status']];
                printf('<tr><td>%s</td><td>%s · %s</td><td>%d</td><td>%s</td><td>%s</td></tr>', $order_link($j['order_id']), esc_html(CB_Settings::deck($j['deck'])['label'] ?? $j['deck']),
                    esc_html($j['kind'] === 'pdf' ? 'PDF' : 'studio'), (int) $j['copies'], $state,
                    $j['status'] === 'failed' ? '<a href="' . esc_url(self::action_url('retry', ['job' => $j['uid']])) . '">Relancer</a>' : '');
            }
            echo '</tbody></table>';
        }

        // Jeux prêts en attente d'un lot
        echo '<h2>Prêts, en attente de lot</h2>';
        $groups = CB_Production::waiting();
        if (!$groups) {
            echo '<p>Aucun jeu en attente.</p>';
        } else {
            echo '<table class="widefat striped"><thead><tr><th>Format</th><th>Carton</th><th>Jeux</th><th>Attente</th><th>Départ prévu</th><th></th></tr></thead><tbody>';
            foreach ($groups as $key => $g) {
                $next = $g['decks'] >= $g['per_sheet'] ? 'livre plein : au prochain passage'
                    : ($g['decks'] >= CB_Production::RULES['slot_min_decks'] ? 'au prochain créneau' : sprintf('encore %d jeu(x) pour un créneau, sinon après %d h', CB_Production::RULES['slot_min_decks'] - $g['decks'], CB_Production::RULES['max_wait_hours']));
                printf('<tr><td>%s</td><td>%s</td><td>%d / %d par livre</td><td>%.0f h</td><td>%s</td><td><a class="button" href="%s">Lancer un lot maintenant</a></td></tr>',
                    esc_html($format($g['format'])), esc_html($media($g['media'])), $g['decks'], $g['per_sheet'], $g['wait_hours'], esc_html($next),
                    esc_url(self::action_url('launch', ['group' => $key])));
            }
            echo '</tbody></table>';
        }

        // Lots
        echo '<h2>Lots</h2>';
        $lots = CB_Store::recent_lots(30);
        if (!$lots) {
            echo '<p>Aucun lot pour l’instant.</p>';
        } else {
            echo '<table class="widefat striped"><thead><tr><th>Lot</th><th>Créé</th><th>Format · carton</th><th>Jeux</th><th>Feuilles SRA3</th><th>État</th><th>Fichiers</th><th></th></tr></thead><tbody>';
            foreach ($lots as $l) {
                $state = ['planned' => 'en file', 'building' => 'fabrication du PDF…', 'ready' => '<strong style="color:#1e7a4f">prêt à imprimer</strong>', 'printed' => 'imprimé',
                    'failed' => '<span style="color:#c4172c">erreur : ' . esc_html((string) $l['error']) . '</span>'][$l['status']] ?? esc_html($l['status']);
                $files = in_array($l['status'], ['ready', 'printed'], true)
                    ? sprintf('<a class="button button-primary" href="%s">PDF d’impression</a> <a class="button" href="%s">Fiche de lot</a>',
                        esc_url(self::action_url('download', ['lot' => $l['id']])), esc_url(self::prod_url(['lot' => $l['id']])))
                        . (is_file(CB_Production::boxes_file($l['id'])) ? sprintf(' <a class="button" href="%s">PDF étuis perso (%d)</a>',
                            esc_url(self::action_url('download', ['lot' => $l['id'], 'file' => 'etuis'])), (int) (CB_Store::lot($l['id'])['manifest']['packs']['custom'] ?? 0)) : '') : '';
                $act = $l['status'] === 'ready' ? '<a href="' . esc_url(self::action_url('printed', ['lot' => $l['id']])) . '">Marquer imprimé</a>'
                    : ($l['status'] === 'failed' ? '<a href="' . esc_url(self::action_url('rebuild', ['lot' => $l['id']])) . '">Refaire</a>' : '');
                printf('<tr><td><code>%s</code><br><small>%s</small></td><td>%s</td><td>%s · %s</td><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                    esc_html($l['id']), esc_html((string) $l['reason']), esc_html(get_date_from_gmt($l['created_at'], 'd/m H:i')), esc_html($format($l['format'])), esc_html($media($l['media'])),
                    (int) $l['decks'], $l['sheets'] ? (int) $l['sheets'] : '—', $state, $files, $act);
            }
            echo '</tbody></table>';
            echo '<p class="description">Étuis personnalisés : le bouton « PDF étuis perso » donne un PDF par lot (une page par jeu, étui à plat avec fond perdu, découpe en ton direct CutContour, rainage en ton direct Rainage), à transmettre à l’imprimeur du groupe. Étuis à fenêtre : à sortir du stock (voir la fiche de lot).</p>';
            echo '<p class="description">Fiery : échelle 100 %, sans rotation automatique ni imposition Fiery, recto verso <strong>petit côté</strong>, profil source CMJN FOGRA51 (PSO Coated v3).</p>';
        }
        // Prix des options d'étui
        echo '<h2>Conditionnement</h2><form method="post" action="' . esc_url(admin_url('admin-post.php?action=cb_prod&do=prices')) . '">';
        wp_nonce_field('cb_prod');
        echo '<p>De base : sous film rétractable (inclus). Options, par jeu, ajoutées au prix après la remise quantité :</p><table class="form-table">';
        foreach (['fenetre', 'custom'] as $p) {
            printf('<tr><th><label for="pp-%1$s">%2$s</label></th><td><input id="pp-%1$s" name="pack_price_%1$s" type="text" inputmode="decimal" size="6" value="%3$s"> € TTC%4$s</td></tr>',
                $p, esc_html(CB_Box::PACKS[$p]['label']), esc_attr(number_format(CB_Box::price($p), 2, ',', '')),
                isset(CB_Box::PACKS[$p]['formats']) ? ' <span class="description">(proposé en format ' . esc_html(implode(', ', CB_Box::PACKS[$p]['formats'])) . ')</span>' : '');
        }
        echo '</table><p>Photos de présentation (mockups) montrées au client à l’étape « L’étui » : adresse d’une image de la médiathèque (Médias → l’image → « Copier l’URL »). Sans photo, le studio affiche un aperçu dessiné.</p><table class="form-table">';
        foreach (array_keys(CB_Box::PACKS) as $p) {
            $url = CB_Box::photo($p);
            printf('<tr><th><label for="ph-%1$s">%2$s</label></th><td><input id="ph-%1$s" name="pack_photo_%1$s" type="url" class="regular-text" value="%3$s" placeholder="https://…/mockup.jpg">%4$s</td></tr>',
                $p, esc_html(CB_Box::PACKS[$p]['label']), esc_attr($url), $url ? ' <img src="' . esc_url($url) . '" alt="" style="height:48px;vertical-align:middle;margin-left:8px;border-radius:4px">' : '');
        }
        echo '</table>';
        submit_button('Enregistrer');
        echo '</form>';
        printf('<p><a class="button" href="%s">Fichier d’impression de l’étui à fenêtre Carte Blanche</a> <span class="description">Poker 54 cartes, à faire fabriquer en série pour le stock : fond perdu, découpe (fenêtre comprise) et rainage en tons directs.</span></p>',
            esc_url(self::action_url('stock')));
        echo '</div>';
    }

    /** Fiche de lot imprimable : pour chaque livre, la commande de chaque pile. */
    private static function lot_sheet(string $id): void
    {
        $lot = CB_Store::lot($id);
        if (!$lot || !$lot['manifest']) {
            echo '<div class="wrap"><p>Lot introuvable.</p></div>';
            return;
        }
        $m = $lot['manifest'];
        echo '<div class="wrap cb-lot-sheet"><style>@media print{#adminmenumain,#wpadminbar,#wpfooter,.cb-noprint{display:none!important}#wpcontent{margin:0!important}}</style>';
        echo '<p class="cb-noprint"><a href="' . esc_url(self::prod_url()) . '">← Production</a> · <a href="#" onclick="window.print();return false">Imprimer la fiche</a></p>';
        printf('<h1>Fiche de lot %s</h1><p><strong>%s</strong> · %s · %s · %d jeux · %d feuilles SRA3 · recto verso petit côté</p>',
            esc_html($id), esc_html(CB_Settings::FORMATS[$m['format']]['label'] ?? $m['format']), esc_html(CB_Settings::MEDIA[$m['media']]['label'] ?? $m['media']),
            esc_html($m['layout']), (int) $lot['decks'], (int) $lot['sheets']);
        $packs = $m['packs'] ?? [];
        if (!empty($packs['fenetre']) || !empty($packs['custom'])) {
            printf('<p><strong>Conditionnement :</strong> %d sous film · %d étui(s) à fenêtre à sortir du stock · %d étui(s) personnalisé(s) (PDF « étuis perso » à envoyer à l’imprimeur du groupe).</p>',
                $packs['film'] ?? 0, $packs['fenetre'] ?? 0, $packs['custom'] ?? 0);
        }
        echo '<p>Couper chaque livre de feuilles d’un seul coup : chaque pile est un jeu complet et trié, sa carte d’identification sur le dessus (à retirer avant la mise en étui). '
            . 'Piles numérotées dans l’ordre de lecture de la feuille : de haut en bas, de gauche à droite (recto).</p>';
        foreach ($m['books'] as $book) {
            printf('<h2>Livre %d · feuilles %d à %d (%d feuilles)</h2>', $book['book'], $book['first_sheet'], $book['first_sheet'] + $book['sheets'] - 1, $book['sheets']);
            echo '<table class="widefat striped" style="max-width:900px"><thead><tr><th>Pile</th><th>Commande</th><th>Client</th><th>Exemplaire</th><th>Cartes</th><th>Conditionnement</th><th>✓</th></tr></thead><tbody>';
            foreach ($book['stacks'] as $s) {
                printf('<tr><td><strong>%d</strong></td><td>#%s</td><td>%s</td><td>%d / %d</td><td>%d</td><td>%s</td><td>☐</td></tr>', $s['stack'], esc_html($s['order']), esc_html($s['name']),
                    $s['copy'], $s['copies'], $s['cards'], esc_html(CB_Box::label($s['pack'] ?? 'film')));
            }
            echo '</tbody></table>';
        }
        echo '</div>';
    }
}
