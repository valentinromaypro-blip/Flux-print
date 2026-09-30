<?php
/**
 * Détourage des visages (MediaPipe, Apache-2.0) : moteur WebAssembly et modèle « selfie multiclass ».
 *
 * Ces fichiers (27 Mo) ne sont pas dans le zip du plugin, trop lourd pour l'envoi par l'admin chez
 * OVH : le serveur les télécharge lui-même une fois (tâche de fond), les vérifie (empreinte SHA-1
 * des versions testées) et les sert depuis le site. Le navigateur du client n'appelle aucun service
 * tiers. Tant qu'ils manquent, le studio fonctionne avec un visage en ovale au lieu du détourage.
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
            // Type MIME du WebAssembly (sinon le navigateur compile plus lentement)
            file_put_contents("$dir/.htaccess", "AddType application/wasm .wasm\n");
        }
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

    /** Adresse publique des fichiers pour le studio ('' : pas encore installés). */
    public static function url(): string
    {
        if (self::bundled()) {
            return CB_URL . 'assets/mediapipe/';
        }
        return self::ready() ? wp_upload_dir()['baseurl'] . '/carte-blanche-public/mediapipe/' : '';
    }

    /** Dans l'admin : lance l'installation en tâche de fond si besoin (une tentative par heure). */
    public static function ensure(): void
    {
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
