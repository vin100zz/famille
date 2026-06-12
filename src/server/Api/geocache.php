<?php
/**
 * Cache de géocodage Nominatim côté serveur.
 *
 * GET  → retourne le cache complet {query: [lat,lng]|null, …}
 * POST → fusionne les nouvelles entrées {query: [lat,lng]|null, …}
 *         et les persiste dans geocache.json
 */
require_once __DIR__ . '/../bootstrap.php';

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

// ── GET : lecture du cache ────────────────────────────────────────────────
if ($method === 'GET') {
    if (!file_exists(GEOCACHE_PATH)) {
        Response::json(new stdClass());
    }
    $data = json_decode(file_get_contents(GEOCACHE_PATH), true);
    Response::json($data ?: new stdClass());
}

// ── POST : ajout de nouvelles entrées ────────────────────────────────────
if ($method === 'POST') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true);

    if (!is_array($body) || empty($body)) {
        Response::error('Corps de requête invalide ou vide', 400);
    }

    // Ouverture avec verrouillage exclusif (concurrent-safe)
    $fp = fopen(GEOCACHE_PATH, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        Response::error('Impossible de verrouiller le cache', 500);
    }

    $existing = json_decode(stream_get_contents($fp), true) ?: array();

    // Fusion : les nouvelles entrées écrasent les anciennes
    foreach ($body as $q => $coords) {
        $existing[$q] = $coords; // [lat, lng] ou null
    }

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($existing,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    Response::json(array('ok' => true, 'saved' => count($body)));
}

Response::error('Méthode non supportée', 405);

