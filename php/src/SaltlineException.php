<?php

declare(strict_types=1);

namespace Saltline;

use Psr\Http\Message\ResponseInterface;

/**
 * Error returned by Saltline (never by the provider).
 * Branch on $errorCode, not the message. Treat unknown codes like their $status.
 */
class SaltlineException extends \RuntimeException
{
    /**
     * @param int         $status
     * @param string      $errorCode HTTP_<status> if the body had none.
     * @param string|null $requestId
     * @param mixed       $body      Decoded JSON, or raw text.
     */
    public function __construct(
        string $message,
        public readonly int $status,
        public readonly string $errorCode,
        public readonly ?string $requestId = null,
        public readonly mixed $body = null,
    ) {
        parent::__construct($message, $status);
    }

    public static function fromResponse(ResponseInterface $response): self
    {
        $headers = [];
        foreach ($response->getHeaders() as $name => $values) {
            $headers[$name] = implode(', ', $values);
        }

        return self::fromParts($response->getStatusCode(), $headers, (string) $response->getBody());
    }

    /**
     * PSR-7-free so the shared fixtures can test it.
     *
     * @param array<string, string> $headers
     */
    public static function fromParts(int $status, array $headers, string $text): self
    {
        $body = $text;
        $code = null;
        $message = null;

        try {
            $body = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            // Gateway page; keep the raw text.
        }

        if (is_array($body) && !array_is_list($body)) {
            if (is_string($body['code'] ?? null) && $body['code'] !== '') {
                $code = $body['code'];
            }
            if (is_string($body['error'] ?? null) && $body['error'] !== '') {
                $message = $body['error'];
            }
        }

        return new self(
            $message ?? "Saltline returned HTTP {$status}.",
            $status,
            $code ?? Headers::get($headers, 'x-saltline-error-code') ?? "HTTP_{$status}",
            Headers::get($headers, 'x-saltline-request-id'),
            $body,
        );
    }
}
