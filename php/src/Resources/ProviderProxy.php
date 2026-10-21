<?php

declare(strict_types=1);

namespace Saltline\Resources;

use Psr\Http\Message\ResponseInterface;
use Saltline\SaltlineException;
use Saltline\Transport;

/** Calls provider APIs with the connection's credentials. */
final class ProviderProxy
{
    public function __construct(private readonly Transport $transport)
    {
    }

    /**
     * Calls the provider. Provider errors are returned, only Saltline errors throw.
     *
     * @param string                $path        e.g. "1/boards/abc123"
     * @param mixed                 $body        Sent as JSON; $contentType sets what the provider gets.
     * @param array<string, string> $query
     * @param array<string, string> $headers
     * @param string|null           $version     See X-Saltline-Version-Served on the response.
     * @param string|null           $contentType e.g. application/x-www-form-urlencoded
     *
     * @throws SaltlineException
     */
    public function request(
        string $method,
        string $provider,
        string $path,
        string $connectionKey,
        mixed $body = null,
        array $query = [],
        array $headers = [],
        ?string $integrationKey = null,
        ?string $version = null,
        ?string $contentType = null,
    ): ResponseInterface {
        $response = $this->transport->send(
            strtoupper($method),
            $this->path($provider, $path),
            $this->headers($headers, $connectionKey, $integrationKey, $version, $contentType),
            $query,
            $body,
        );

        // Only Saltline's own errors carry this header.
        if ($response->hasHeader('x-saltline-error-code')) {
            throw SaltlineException::fromResponse($response);
        }

        return $response;
    }

    /**
     * Calls the provider async; the response is POSTed to $callbackUrl (public HTTPS).
     * Verify the callback with Signature::verifyWebhook().
     *
     * @param array<string, string> $query
     * @param array<string, string> $headers
     *
     * @return array{requestId: string}
     *
     * @throws SaltlineException
     */
    public function enqueue(
        string $method,
        string $provider,
        string $path,
        string $connectionKey,
        string $callbackUrl,
        mixed $body = null,
        array $query = [],
        array $headers = [],
        ?string $integrationKey = null,
        ?string $version = null,
        ?string $contentType = null,
    ): array {
        $response = $this->transport->send(
            strtoupper($method),
            $this->path($provider, $path),
            [
                ...$this->headers($headers, $connectionKey, $integrationKey, $version, $contentType),
                'x-saltline-callback-url' => $callbackUrl,
            ],
            $query,
            $body,
        );

        if ($response->getStatusCode() !== 202) {
            throw SaltlineException::fromResponse($response);
        }

        /** @var array{requestId: string} */
        return json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
    }

    private function path(string $provider, string $path): string
    {
        $providerPath = ltrim($path, '/');
        if ($providerPath === '' || in_array('..', explode('/', $providerPath), true)) {
            throw new \InvalidArgumentException('Saltline: the proxy path must be a non-empty provider API path.');
        }

        return 'proxy/' . Transport::segment($provider) . '/' . $providerPath;
    }

    /**
     * Caller headers can't override x-saltline-*.
     *
     * @param array<string, string> $headers
     *
     * @return array<string, string|null>
     */
    private function headers(
        array $headers,
        string $connectionKey,
        ?string $integrationKey,
        ?string $version,
        ?string $contentType,
    ): array {
        $merged = [];
        foreach ($headers as $name => $value) {
            if (stripos((string) $name, 'x-saltline-') !== 0) {
                $merged[$name] = $value;
            }
        }

        return [
            ...$merged,
            'x-saltline-connection-key' => $connectionKey,
            'x-saltline-integration-key' => $integrationKey,
            'x-saltline-version' => $version,
            'x-saltline-content-type' => $contentType,
        ];
    }
}
