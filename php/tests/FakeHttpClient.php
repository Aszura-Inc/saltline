<?php

declare(strict_types=1);

namespace Saltline\Tests;

use GuzzleHttp\Psr7\Response;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/** A PSR-18 client that records every request and answers from a queue. */
final class FakeHttpClient implements ClientInterface
{
    /** @var list<RequestInterface> */
    public array $requests = [];

    /** @var list<ResponseInterface> */
    private array $responses;

    public function __construct(ResponseInterface ...$responses)
    {
        $this->responses = array_values($responses);
    }

    /** @param array<string, string> $headers */
    public static function json(int $status, mixed $body, array $headers = []): Response
    {
        return new Response(
            $status,
            ['Content-Type' => 'application/json', ...$headers],
            json_encode($body, JSON_THROW_ON_ERROR),
        );
    }

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $this->requests[] = $request;
        $next = array_shift($this->responses);
        if ($next === null) {
            throw new \RuntimeException('FakeHttpClient: no response queued');
        }

        return $next;
    }

    /** @return array<string, mixed>|null */
    public function body(int $index): ?array
    {
        $raw = (string) $this->requests[$index]->getBody();

        return $raw === '' ? null : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }
}
