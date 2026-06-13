<?php
// Suppress deprecated $HTTP_RAW_POST_DATA warning (PHP < 7, EasyPHP)
if (PHP_MAJOR_VERSION < 7) {
    @ini_set('always_populate_raw_post_data', '-1');
}
error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/Repository/IPersonRepository.php';
require_once __DIR__ . '/Repository/JsonPersonRepository.php';
require_once __DIR__ . '/Api/Response.php';

/**
 * Fabrique le repository selon DATA_SOURCE.
 *
 * @return IPersonRepository
 */
function createRepository()
{
    switch (DATA_SOURCE) {
        case 'json':
            return new JsonPersonRepository(JSON_DATA_PATH);

        default:
            throw new RuntimeException('Source de données inconnue : ' . DATA_SOURCE);
    }
}
