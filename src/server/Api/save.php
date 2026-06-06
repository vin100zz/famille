<?php
require_once __DIR__ . '/../bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    Response::json(array('ok' => true));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Méthode non supportée', 405);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    Response::error('Corps JSON invalide');
}

$type = isset($body['type']) ? $body['type'] : '';
$id   = isset($body['id'])   ? trim($body['id']) : '';
$data = isset($body['data']) ? $body['data'] : null;

if ($type === '' || $id === '' || $data === null) {
    Response::error('Paramètres manquants : type, id, data requis');
}

try {
    $repo = createRepository();

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

