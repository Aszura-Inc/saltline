<?php

declare(strict_types=1);

namespace Saltline;

use Psr\Http\Message\MessageInterface;

/**
 * Verifies API responses, webhooks and proxy callbacks.
 * Signature is hex HMAC-SHA256(timestamp . rawBody), keyed with the base64-decoded secret.
 * During rotation the header holds two comma-separated signatures.
 */
final class Signature
{
    public const DEFAULT_TOLERANCE_SECONDS = 300;

    /**
     * Checks signature and timestamp. Never throws.
     *
     * @param string              $body    Use the raw body; re-encoded JSON won't verify.
     * @param string|list<string> $secrets Base64; pass several while rotating.
     */
    public static function verify(
        string $body,
        ?string $timestamp,
        ?string $signature,
        string|array $secrets,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
        ?\DateTimeInterface $now = null,
    ): bool {
        if ($timestamp === null || $timestamp === '' || $signature === null || $signature === '') {
            return false;
        }

        $signedAt = self::parseTimestamp($timestamp);
        if ($signedAt === null) {
            return false;
        }

        $nowSeconds = (float) ($now ?? new \DateTimeImmutable())->format('U.u');
        if (abs($nowSeconds - $signedAt) > $toleranceSeconds) {
            return false;
        }

        $candidates = array_values(array_filter(
            array_map(static fn (string $part): string => strtolower(trim($part)), explode(',', $signature)),
            static fn (string $part): bool => $part !== '',
        ));
        if ($candidates === []) {
            return false;
        }

        foreach ((array) $secrets as $secret) {
            $key = base64_decode((string) $secret, true);
            if ($key === false || $key === '') {
                continue;
            }
            $expected = hash_hmac('sha256', $timestamp . $body, $key);
            foreach ($candidates as $candidate) {
                if (hash_equals($expected, $candidate)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Verifies a webhook or proxy callback. Use the raw body (php://input).
     *
     * @param array<string, string|list<string>|null> $headers
     * @param string|list<string>                      $secrets
     */
    public static function verifyWebhook(
        array $headers,
        string $rawBody,
        string|array $secrets,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
        ?\DateTimeInterface $now = null,
    ): bool {
        return self::verify(
            $rawBody,
            Headers::get($headers, 'x-saltline-timestamp'),
            Headers::get($headers, 'x-saltline-hmac-256'),
            $secrets,
            $toleranceSeconds,
            $now,
        );
    }

    /**
     * Verifies a PSR-7 message. Rewinds the body after reading if seekable.
     *
     * @param string|list<string> $secrets
     */
    public static function verifyMessage(
        MessageInterface $message,
        string|array $secrets,
        int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
        ?\DateTimeInterface $now = null,
    ): bool {
        $stream = $message->getBody();
        if ($stream->isSeekable()) {
            $stream->rewind();
        }
        $body = $stream->getContents();
        if ($stream->isSeekable()) {
            $stream->rewind();
        }

        return self::verify(
            $body,
            $message->getHeaderLine('x-saltline-timestamp') ?: null,
            $message->getHeaderLine('x-saltline-hmac-256') ?: null,
            $secrets,
            $toleranceSeconds,
            $now,
        );
    }

    private static function parseTimestamp(string $timestamp): ?float
    {
        // e.g. 2026-10-21T12:00:00.000Z
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/', $timestamp) !== 1) {
            return null;
        }

        try {
            return (float) (new \DateTimeImmutable($timestamp))->format('U.u');
        } catch (\Exception) {
            return null;
        }
    }
}
