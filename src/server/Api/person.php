<?php
require_once __DIR__ . '/../bootstrap.php';

$id = isset($_GET['id']) ? trim($_GET['id']) : '';

if ($id === '') {
    Response::error('Paramètre id manquant');
}

try {
    $repo = createRepository();
    $data = $repo->getPerson($id);

    if ($data === null) {
        Response::notFound('Personne introuvable : ' . $id);
    }

    Response::json($data);
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
