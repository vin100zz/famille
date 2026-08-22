<?php
require_once __DIR__ . '/../bootstrap.php';

$nom    = isset($_GET['nom'])    ? trim($_GET['nom'])    : '';
$prenom = isset($_GET['prenom']) ? trim($_GET['prenom']) : '';
$sexe   = isset($_GET['sexe']) && ($_GET['sexe'] === 'M' || $_GET['sexe'] === 'F') ? $_GET['sexe'] : null;

if (mb_strlen($nom, 'UTF-8') < 2) {
    Response::json(array());
}

try {
    $repo = createRepository();
    Response::json($repo->findSimilarPersons($nom, $prenom, $sexe));
} catch (Exception $e) {
    Response::error($e->getMessage(), 500);
}
