<?php
/**
 * Listage des images disponibles sous IMAGES_BASE_PATH.
 *
 * GET ?dir=chemin/relatif
 *   → { dir, dirs: [{name, path}], files: [{name, path}] }
 *
 * Sécurité : tout chemin tentant d'échapper à IMAGES_BASE_PATH est rejeté.
 */
require_once __DIR__ . '/../bootstrap.php';

if (!defined('IMAGES_BASE_PATH') || !IMAGES_BASE_PATH || !is_dir(IMAGES_BASE_PATH)) {
    Response::error('Répertoire d\'images non configuré ou introuvable.', 500);
}

$BASE = IMAGES_BASE_PATH;

$relDir = isset($_GET['dir']) ? trim($_GET['dir'], '/\\') : '';

// Validation : pas de '..' ni de séquences suspectes
if ($relDir !== '' && (
    strpos($relDir, '..') !== false ||
    preg_match('/[:\\\\]/', $relDir)
)) {
    Response::error('Chemin invalide.', 400);
}

$targetDir = $relDir !== ''
    ? $BASE . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relDir)
    : $BASE;

$real = realpath($targetDir);
if ($real === false) {
    Response::error('Dossier introuvable.', 404);
}

// Vérification que le chemin normalisé reste sous BASE
if (strncmp($real, $BASE, strlen($BASE)) !== 0) {
    Response::error('Accès interdit.', 403);
}

$IMAGE_EXT = '/\.(jpe?g|png|gif|webp|svg|bmp|tiff?)$/i';

$dirs  = array();
$files = array();

$it = new DirectoryIterator($real);
foreach ($it as $entry) {
    if ($entry->isDot()) { continue; }
    $name    = $entry->getFilename();
    $relPath = $relDir !== '' ? $relDir . '/' . $name : $name;

    if ($entry->isDir()) {
        $dirs[] = array('name' => $name, 'path' => $relPath);
    } elseif ($entry->isFile() && preg_match($IMAGE_EXT, $name)) {
        $files[] = array('name' => $name, 'path' => $relPath);
    }
}

usort($dirs,  function($a, $b) { return strcasecmp($a['name'], $b['name']); });
usort($files, function($a, $b) { return strcasecmp($a['name'], $b['name']); });

Response::json(array('dir' => $relDir, 'dirs' => $dirs, 'files' => $files));

