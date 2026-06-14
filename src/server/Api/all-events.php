<?php
require_once __DIR__ . '/../bootstrap.php';

try {
    $raw  = file_get_contents(JSON_DATA_PATH);
    $data = json_decode($raw, true);

    /** Extrait l'année d'une date GEDCOM (retourne null si non déterminable). */
    function parseYear($date) {
        if (!$date) return null;
        // BET 1740 AND 1750 → moyenne
        if (preg_match('/BET\s+(\d{4})\s+AND\s+(\d{4})/i', $date, $m)) {
            return (int)(((int)$m[1] + (int)$m[2]) / 2);
        }
        // Cherche un nombre à 4 chiffres (gère tous les autres formats)
        if (preg_match('/\b(\d{4})\b/', $date, $m)) {
            return (int)$m[1];
        }
        return null;
    }

    /** Vérifie qu'un lieu est exploitable. */
    function hasLieu($ev) {
        return isset($ev['lieu']) && is_array($ev['lieu'])
            && (isset($ev['lieu']['ville']) || isset($ev['lieu']['adresse']));
    }

    $events = array();

    foreach ($data['individus'] as $id => $p) {
        $nom    = isset($p['nom'])    ? $p['nom']    : '';
        $prenom = isset($p['prenom']) ? $p['prenom'] : '';
        $sexe   = isset($p['sexe'])   ? $p['sexe']   : '';

        $evTypes = array(
            'Naissance' => isset($p['naissance'])  ? $p['naissance']  : null,
            'Décès'     => isset($p['deces'])       ? $p['deces']      : null,
            'Sépulture' => isset($p['sepulture'])   ? $p['sepulture']  : null,
        );
        foreach ($evTypes as $type => $ev) {
            if (!$ev || !hasLieu($ev)) continue;
            $year = parseYear(isset($ev['date']) ? $ev['date'] : null);
            if (!$year) continue;
            $events[] = array(
                'nom'    => $nom,
                'prenom' => $prenom,
                'sexe'   => $sexe,
                'type'   => $type,
                'year'   => $year,
                'lieu'   => $ev['lieu'],
            );
        }
        foreach (isset($p['residences']) ? $p['residences'] : array() as $r) {
            if (!hasLieu($r)) continue;
            $year = parseYear(isset($r['date']) ? $r['date'] : null);
            if (!$year) continue;
            $events[] = array(
                'nom'    => $nom,
                'prenom' => $prenom,
                'sexe'   => $sexe,
                'type'   => 'Résidence',
                'year'   => $year,
                'lieu'   => $r['lieu'],
            );
        }
    }

    // Mariages
    foreach ($data['familles'] as $fid => $f) {
        if (!isset($f['mariage']) || !hasLieu($f['mariage'])) continue;
        $year = parseYear(isset($f['mariage']['date']) ? $f['mariage']['date'] : null);
        if (!$year) continue;
        $events[] = array(
            'nom'    => '',
            'prenom' => '',
            'sexe'   => '',
            'type'   => 'Mariage',
            'year'   => $year,
            'lieu'   => $f['mariage']['lieu'],
        );
    }

    // Trie par année
    usort($events, function($a, $b) { return $a['year'] - $b['year']; });

    Response::json($events);
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
