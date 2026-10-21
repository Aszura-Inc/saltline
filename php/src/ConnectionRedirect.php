<?php

declare(strict_types=1);

namespace Saltline;

/** Parses the redirectUrl query: connectionKey on success, error/error_message on failure. */
final class ConnectionRedirect
{
    private function __construct(
        public readonly bool $ok,
        public readonly ?string $connectionKey,
        public readonly ?string $error,
        public readonly ?string $errorMessage,
    ) {
    }

    public static function parse(string $url): self
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $params);

        $error = $params['error'] ?? null;
        if (is_string($error)) {
            $message = $params['error_message'] ?? null;

            return new self(false, null, $error, is_string($message) ? $message : null);
        }

        $connectionKey = $params['connectionKey'] ?? null;
        if (!is_string($connectionKey) || $connectionKey === '') {
            return new self(false, null, 'missing_connection_key', null);
        }

        return new self(true, $connectionKey, null, null);
    }
}
