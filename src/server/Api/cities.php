<?php
require_once __DIR__ . '/../bootstrap.php';

try {
    $raw  = file_get_contents(JSON_DATA_PATH);
    $data = json_decode($raw, true);

    $cityMap   = array(); // "ville||dept"    => count
    $addrMap   = array(); // "adresse||ville||dept" => count
    $profMap   = array(); // "profession"     => count

    function collectLieu2($lieu, &$cityMap, &$addrMap) {
        if (!is_array($lieu)) return;
        $ville   = isset($lieu['ville'])    ? trim($lieu['ville'])    : '';
        $dept    = isset($lieu['dept_num']) ? trim($lieu['dept_num']) : '';
        $adresse = isset($lieu['adresse'])  ? trim($lieu['adresse'])  : '';

        if ($ville !== '') {
            $key = $ville . '||' . $dept;
            $cityMap[$key] = isset($cityMap[$key]) ? $cityMap[$key] + 1 : 1;
        }
        if ($adresse !== '') {
            $key = $adresse . '||' . $ville . '||' . $dept;
            $addrMap[$key] = isset($addrMap[$key]) ? $addrMap[$key] + 1 : 1;
        }
    }

    function collectEvents2($events, &$cityMap, &$addrMap) {
        if (!is_array($events)) return;
        foreach ($events as $ev) {
            if (isset($ev['lieu'])) collectLieu2($ev['lieu'], $cityMap, $addrMap);
        }
    }

    foreach ($data['individus'] as $p) {
        collectEvents2(array(
            isset($p['naissance'])  ? $p['naissance']  : null,
            isset($p['deces'])      ? $p['deces']      : null,
            isset($p['sepulture'])  ? $p['sepulture']  : null,
        ), $cityMap, $addrMap);
        collectEvents2(isset($p['residences']) ? $p['residences'] : array(), $cityMap, $addrMap);
        if (isset($p['professions']) && is_array($p['professions'])) {
            foreach ($p['professions'] as $prof) {
                $prof = trim($prof);
                if ($prof !== '') {
                    $profMap[$prof] = isset($profMap[$prof]) ? $profMap[$prof] + 1 : 1;
                }
            }
        }
    }
    foreach ($data['familles'] as $f) {
        if (isset($f['mariage']['lieu'])) collectLieu2($f['mariage']['lieu'], $cityMap, $addrMap);
    }

    // Villes triées par fréquence
    arsort($cityMap);
    $cities = array();
    foreach ($cityMap as $key => $count) {
        list($ville, $dept) = explode('||', $key, 2);
        $cities[] = array('ville' => $ville, 'dept' => $dept);
    }

    // Adresses triées par fréquence
    arsort($addrMap);
    $addresses = array();
    foreach ($addrMap as $key => $count) {
        list($adresse, $ville, $dept) = explode('||', $key, 3);
        $addresses[] = array('adresse' => $adresse, 'ville' => $ville, 'dept' => $dept);
    }

    arsort($profMap);
    $professions = array_keys($profMap);

    Response::json(array('cities' => $cities, 'addresses' => $addresses, 'professions' => $professions));
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
