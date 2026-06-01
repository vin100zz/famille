<?php
require_once __DIR__ . '/../bootstrap.php';

$sosa = isset($_GET['sosa']) ? (int) $_GET['sosa'] : 0;

if ($sosa < 2) {
    Response::error('Paramètre sosa requis (>= 2)');
}

try {
    $repo = createRepository();
    $data = $repo->getSosaTree($sosa);

    if ($data === null) {
        Response::notFound('Sosa introuvable : ' . $sosa);
    }

    Response::json($data);
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
