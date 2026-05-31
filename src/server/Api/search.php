<?php
require_once __DIR__ . '/../bootstrap.php';

$query = isset($_GET['q']) ? trim($_GET['q']) : '';

if (mb_strlen($query, 'UTF-8') < 2) {
    Response::json(array());
}

try {
    $repo = createRepository();
    Response::json($repo->search($query));
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
