<?php
/**
 * Helpers pour les réponses JSON de l'API.
 */
class Response
{
    public static function json($data, $status = 200)
    {
        self::sendHeaders($status);
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error($message, $status = 400)
    {
        self::json(array('error' => $message), $status);
    }

    public static function notFound($message = 'Ressource introuvable')
    {
        self::error($message, 404);
    }

    private static function sendHeaders($status)
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');

        // Répondre immédiatement aux pre-flight CORS
        if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            exit;
        }
    }
}
