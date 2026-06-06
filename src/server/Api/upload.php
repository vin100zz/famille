<?php
require_once __DIR__ . '/../bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    Response::json(array('ok' => true));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Méthode non supportée', 405);
}

if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $code = isset($_FILES['image']) ? $_FILES['image']['error'] : -1;
    Response::error('Aucun fichier valide reçu (code ' . $code . ')');
}

$file    = $_FILES['image'];
$ext     = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
$allowed = array('jpg', 'jpeg', 'png', 'gif', 'webp');

if (!in_array($ext, $allowed)) {
    Response::error('Type de fichier non autorisé : ' . htmlspecialchars($ext));
}

// Vérifie que c'est bien une image
$info = @getimagesize($file['tmp_name']);
if ($info === false) {
    Response::error('Le fichier n\'est pas une image valide');
}

$uploadDir = WEBSITE_PAGES_PATH . DIRECTORY_SEPARATOR . 'uploads';
if (!is_dir($uploadDir)) {
    if (!mkdir($uploadDir, 0755, true)) {
        Response::error('Impossible de créer le dossier uploads', 500);
    }
}

$filename = uniqid('img_', true) . '.' . $ext;
$dest     = $uploadDir . DIRECTORY_SEPARATOR . $filename;

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    Response::error('Échec du déplacement du fichier', 500);
}

Response::json(array('fichier' => 'uploads/' . $filename));

