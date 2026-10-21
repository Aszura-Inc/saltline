<?php

declare(strict_types=1);

namespace Saltline;

use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamFactoryInterface;

/** @internal */
final class Transport
{
    public function __construct(
        public readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly ClientInterface $http,
        private readonly RequestFactoryInterface $requests,
        private readonly StreamFactoryInterface $streams,
    ) {
    }

    /** Encodes a path segment so it can't change the route. */
    public static function segment(string $value): string
    {
        if ($value === '') {
            throw new \InvalidArgumentException('Saltline: a path segment cannot be empty.');
        }

        return rawurlencode($value);
    }

    /**
     * Returns the raw response, any status. Null headers/query values are dropped.
     *
     * @param array<string, string|null> $headers
     * @param array<string, string|null> $query
     * @param mixed                      $body
     */
    public function send(
        string $method,
        string $path,
        array $headers = [],
        array $query = [],
        mixed $body = null,
    ): ResponseInterface {
        $url = $this->baseUrl . '/' . ltrim($path, '/');
        $query = array_filter($query, static fn (?string $value): bool => $value !== null);
        if ($query !== []) {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        }

        $request = $this->requests->createRequest($method, $url)
            ->withHeader('Authorization', 'Bearer ' . $this->apiKey);

        foreach ($headers as $name => $value) {
            if ($value !== null) {
                $request = $request->withHeader($name, $value);
            }
        }

        if ($body !== null) {
            $request = $request->withBody(
                $this->streams->createStream(json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)),
            );
            if (!$request->hasHeader('Content-Type')) {
                $request = $request->withHeader('Content-Type', 'application/json');
            }
        }

        return $this->http->sendRequest($request);
    }

    /**
     * Returns the decoded JSON body. Throws on non-2xx.
     *
     * @param array<string, string|null> $headers
     * @param array<string, string|null> $query
     *
     * @return array<string, mixed>
     *
     * @throws SaltlineException
     */
    public function json(
        string $method,
        string $path,
        array $headers = [],
        array $query = [],
        mixed $body = null,
    ): array {
        $response = $this->send($method, $path, $headers, $query, $body);
        $status = $response->getStatusCode();

        if ($status < 200 || $status >= 300) {
            throw SaltlineException::fromResponse($response);
        }

        $decoded = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        return is_array($decoded) ? $decoded : [];
    }
}
