<?php
/**
 * Micro-chronomètre pour diagnostiquer les écarts de performance de save.php
 * entre utilisateurs/machines. Écrit une ligne par requête dans PERF_LOG_PATH.
 *
 * Utilisation :
 *   Perf::start();                      // au tout début de la requête
 *   Perf::context('type', $type);       // infos utiles au diagnostic
 *   Perf::mark('json_decode', $ms);     // durée d'une étape (cumulée si appelée plusieurs fois)
 * Le flush() final (déclenché à la fin du script, même après exit()) écrit la ligne.
 */
class Perf
{
    private static $marks   = array();
    private static $counts  = array();
    private static $context = array();
    private static $t0      = null;

    public static function start()
    {
        self::$t0 = microtime(true);
        register_shutdown_function(array(__CLASS__, 'flush'));
    }

    public static function context($key, $value)
    {
        self::$context[$key] = $value;
    }

    /** Ajoute $ms au marqueur $label (cumulé si appelé plusieurs fois dans la requête). */
    public static function mark($label, $ms)
    {
        self::$marks[$label]  = (isset(self::$marks[$label])  ? self::$marks[$label]  : 0) + $ms;
        self::$counts[$label] = (isset(self::$counts[$label]) ? self::$counts[$label] : 0) + 1;
    }

    /** Chronomètre l'exécution de $fn et ajoute sa durée au marqueur $label. */
    public static function time($label, $fn)
    {
        $t = microtime(true);
        $result = $fn();
        self::mark($label, (microtime(true) - $t) * 1000);
        return $result;
    }

    public static function flush()
    {
        if (self::$t0 === null || !defined('PERF_LOG_PATH') || !PERF_LOG_PATH) {
            return;
        }
        $totalMs = (microtime(true) - self::$t0) * 1000;

        $parts = array(
            date('c'),
            'ip=' . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '?'),
        );
        foreach (self::$context as $k => $v) {
            $parts[] = $k . '=' . $v;
        }
        foreach (self::$marks as $label => $ms) {
            $parts[] = $label . '_ms=' . round($ms, 1);
            if (self::$counts[$label] > 1) {
                $parts[] = $label . '_calls=' . self::$counts[$label];
            }
        }
        $parts[] = 'total_ms=' . round($totalMs, 1);

        @file_put_contents(PERF_LOG_PATH, implode(' ', $parts) . "\n", FILE_APPEND | LOCK_EX);
        self::$t0 = null; // évite un double flush si flush() est rappelé
    }
}
