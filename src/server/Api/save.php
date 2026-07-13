<?php
require_once __DIR__ . '/../bootstrap.php';

Perf::start();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    Response::json(array('ok' => true));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Méthode non supportée', 405);
}

$rawBody = Perf::time('read_body', function () { return file_get_contents('php://input'); });
Perf::context('payload_bytes', strlen($rawBody));
$body = Perf::time('decode_body', function () use ($rawBody) { return json_decode($rawBody, true); });
if (!is_array($body)) {
    Response::error('Corps JSON invalide');
}

$type = isset($body['type']) ? $body['type'] : '';
$id   = isset($body['id'])   ? trim($body['id']) : '';
$data = isset($body['data']) ? $body['data'] : null;

Perf::context('type', $type);
Perf::context('id', $id);
if ($type === 'save_all' && is_array($data)) {
    Perf::context('update_persons',  isset($data['updatePersons'])  ? count($data['updatePersons'])  : 0);
    Perf::context('update_families', isset($data['updateFamilies']) ? count($data['updateFamilies']) : 0);
    Perf::context('new_persons',     isset($data['newPersons'])     ? count($data['newPersons'])     : 0);
    Perf::context('new_families',    isset($data['newFamilies'])    ? count($data['newFamilies'])    : 0);
}

if ($type === '' || $id === '' || $data === null) {
    Response::error('Paramètres manquants : type, id, data requis');
}

try {
    $repo = Perf::time('repo_init', function () { return createRepository(); });

    switch ($type) {
        case 'person':
            $repo->savePerson($id, $data);
            Response::json(array('ok' => true));
            break;
        case 'family':
            $repo->saveFamily($id, $data);
            Response::json(array('ok' => true));
            break;
        case 'save_all':
            $result = $repo->saveAll($data);
            Response::json(array('ok' => true, 'idMap' => $result['idMap']));
            break;
        default:
            Response::error('Type inconnu : ' . htmlspecialchars($type));
    }


} catch (RuntimeException $e) {
    Response::error($e->getMessage(), 500);
}

