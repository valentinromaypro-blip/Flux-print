<?php
/**
 * Détourage des visages (MediaPipe, Apache-2.0) : moteur WebAssembly et modèle « selfie multiclass ».
 *
 * Ces fichiers (27 Mo) ne sont pas dans le zip du plugin, trop lourd pour l'envoi par l'admin chez
 * OVH : le serveur les télécharge lui-même une fois (tâche de fond), les vérifie (empreinte SHA-1
 * des versions testées) et les sert depuis le site. Le navigateur du client n'appelle aucun service
 * tiers, sauf en secours : si ces fichiers ne se chargent pas, le studio les prend aux sources
 * publiques officielles (jsDelivr, Google). Sans aucun des deux, visage en ovale.
 */

defined('ABSPATH') || exit;

final class CB_Segmenter
{
    /** Version de @mediapipe/tasks-vision compilée dans le studio : le moteur doit être le même. */
    private const NPM = '@mediapipe/tasks-vision@1.0.1';
    private const FILES = [
        'vision_wasm_internal.js' => ['1de85ca3715a20f2f224ef776dac637277b90952', 'npm'],
        'vision_wasm_internal.wasm' => ['046aa342e50d9600c7b742b9f4a21960afdd8964', 'npm'],
        'selfie_multiclass_256x256.tflite' => ['804dff26403f469f6b7fc66fcaaf21e522eb3b46',
            'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite'],
    ];

    public static function init(): void
    {
        add_action('cb_install_segmenter', [self::class, 'install']);
        add_action('admin_init', [self::class, 'ensure']);
        add_action('rest_api_init', [self::class, 'route']);
    }

    /** Fichiers livrés dans le plugin (développement) : utilisés tels quels. */
    private static function bundled(): bool
    {
        return is_file(CB_DIR . '/assets/mediapipe/selfie_multiclass_256x256.tflite');
    }

    private static function dir(): string
    {
        $dir = wp_upload_dir()['basedir'] . '/carte-blanche-public/mediapipe';
        if (!is_dir($dir)) {
            wp_mkdir_p($dir);
            file_put_contents("$dir/index.php", "<?php // Silence.\n");
        }
        @unlink("$dir/.htaccess"); // version 0.3 : directive refusée par certains hébergements
        return $dir;
    }

    public static function ready(): bool
    {
        if (self::bundled()) {
            return true;
        }
        $dir = wp_upload_dir()['basedir'] . '/carte-blanche-public/mediapipe';
        foreach (array_keys(self::FILES) as $file) {
            if (!is_file("$dir/$file")) {
                return false;
            }
        }
        return true;
    }

    /**
     * Adresse des fichiers pour le studio ('' : pas encore installés). Servis par le plugin à l'adresse
     * du site lui-même : pas de souci de domaine (multisite), de type de fichier ni de réglage Apache.
     */
    public static function url(): string
    {
        if (self::bundled()) {
            return CB_URL . 'assets/mediapipe/';
        }
        return self::ready() ? rest_url('cb/v1/mediapipe/') : '';
    }

    /** Copie compressée d'un fichier qui s'y prête (le modèle, lui, ne gagne rien). */
    private static function gzip(string $path): bool
    {
        if (str_ends_with($path, '.tflite')) {
            return false;
        }
        if (!is_file("$path.gz") || filemtime("$path.gz") < filemtime($path)) {
            $in = fopen($path, 'rb');
            $out = gzopen("$path.gz.part", 'wb9');
            if (!$in || !$out) {
                return false;
            }
            while (!feof($in)) {
                gzwrite($out, fread($in, 1 << 20));
            }
            fclose($in);
            gzclose($out);
            rename("$path.gz.part", "$path.gz");
        }
        return true;
    }

    public static function route(): void
    {
        register_rest_route('cb/v1', '/mediapipe/(?P<file>[a-z0-9_]+\.(?:js|wasm|tflite))', [
            'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => [self::class, 'serve'],
        ]);
    }

    public static function serve(WP_REST_Request $r)
    {
        $file = (string) $r['file'];
        $path = wp_upload_dir()['basedir'] . '/carte-blanche-public/mediapipe/' . $file;
        if (!isset(self::FILES[$file]) || !is_file($path)) {
            return new WP_Error('cb_missing', 'Fichier de détourage absent.', ['status' => 404]);
        }
        $type = ['js' => 'text/javascript', 'wasm' => 'application/wasm', 'tflite' => 'application/octet-stream'][pathinfo($file, PATHINFO_EXTENSION)];
        $etag = '"' . self::FILES[$file][0] . '"';
        header('Cache-Control: public, max-age=31536000, immutable');
        header("ETag: $etag");
        if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            status_header(304);
            exit;
        }
        header("Content-Type: $type");
        header('Vary: Accept-Encoding');
        // Version compressée (préparée une fois) : le moteur passe de 11,5 à 3,3 Mo
        if (str_contains((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') && self::gzip($path)) {
            @ini_set('zlib.output_compression', '0');
            header('Content-Encoding: gzip');
            $path .= '.gz';
        }
        header('Content-Length: ' . filesize($path));
        while (ob_get_level()) {
            ob_end_clean();
        }
        readfile($path);
        exit;
    }

    /** Dans l'admin : lance l'installation en tâche de fond si besoin (une tentative par heure). */
    public static function ensure(): void
    {
        @unlink(wp_upload_dir()['basedir'] . '/carte-blanche-public/mediapipe/.htaccess'); // laissé par la version 0.3
        if (self::ready() || get_transient('cb_segmenter_try')) {
            return;
        }
        set_transient('cb_segmenter_try', 1, HOUR_IN_SECONDS);
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action('cb_install_segmenter', [], 'carte-blanche');
        }
    }

    /** Téléchargement et vérification ; renvoie un message d'erreur, ou '' si tout est installé. */
    public static function install(): string
    {
        if (self::bundled()) {
            return '';
        }
        @set_time_limit(160);
        $dir = self::dir();
        foreach (self::FILES as $file => [$sha1, $source]) {
            $dest = "$dir/$file";
            if (is_file($dest) && sha1_file($dest) === $sha1) {
                continue;
            }
            $urls = $source === 'npm'
                ? ['https://cdn.jsdelivr.net/npm/' . self::NPM . "/wasm/$file", 'https://unpkg.com/' . self::NPM . "/wasm/$file"]
                : [$source];
            $ok = false;
            foreach ($urls as $url) {
                $tmp = "$dest.part";
                $res = wp_remote_get($url, ['timeout' => 120, 'stream' => true, 'filename' => $tmp]);
                if (!is_wp_error($res) && wp_remote_retrieve_response_code($res) === 200 && is_file($tmp) && sha1_file($tmp) === $sha1) {
                    rename($tmp, $dest);
                    $ok = true;
                    break;
                }
                @unlink($tmp);
            }
            if (!$ok) {
                $error = "Téléchargement de $file impossible ou fichier altéré.";
                update_option('cb_segmenter_error', $error, false);
                return $error;
            }
        }
        delete_option('cb_segmenter_error');
        return '';
    }
}
