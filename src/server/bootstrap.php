<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/Repository/IPersonRepository.php';
require_once __DIR__ . '/Repository/JsonPersonRepository.php';
require_once __DIR__ . '/Api/Response.php';

/**
 * Fabrique le repository selon DATA_SOURCE.
 * C'est ici que l'on échange l'implémentation (JSON → SQLite…).
 *
 * @return IPersonRepository
 */
function createRepository()
{
    switch (DATA_SOURCE) {
        case 'json':
            return new JsonPersonRepository(JSON_DATA_PATH);

        // case 'sqlite':
        //     return new SqlitePersonRepository(SQLITE_PATH);

        default:
            throw new RuntimeException('Source de données inconnue : ' . DATA_SOURCE);
    }
}
