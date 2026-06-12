<?php
/**
 * Configuration de l'application.
 *
 * Pour basculer vers SQLite :
 *   1. Changer DATA_SOURCE en 'sqlite'
 *   2. Décommenter SQLITE_PATH
 *   3. Créer SqlitePersonRepository implémentant IPersonRepository
 *   4. L'ajouter dans bootstrap.php::createRepository()
 */

// Source de données active : 'json' | 'sqlite'
define('DATA_SOURCE', 'json');

// Chemin vers le fichier JSON (résolu depuis la racine du projet)
define('JSON_DATA_PATH',  realpath(__DIR__ . '/../../data') . DIRECTORY_SEPARATOR . 'carle.json');

// Cache de géocodage Nominatim (partagé entre tous les clients)
define('GEOCACHE_PATH',   realpath(__DIR__ . '/../../data') . DIRECTORY_SEPARATOR . 'geocache.json');

// Chemin SQLite (usage futur)
// define('SQLITE_PATH', realpath(__DIR__ . '/../../data') . DIRECTORY_SEPARATOR . 'genealogy.db');

// Origines autorisées pour CORS (* = toutes)
define('CORS_ORIGIN', '*');

// Dossier racine des images du site (website/pages/)
define('WEBSITE_PAGES_PATH', realpath(__DIR__ . '/../../website/pages'));

