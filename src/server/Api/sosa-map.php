<?php
require_once __DIR__ . '/../bootstrap.php';

try {
    $repo = createRepository();
    Response::json($repo->getSosaMap());
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}

