<?php

declare(strict_types=1);

namespace Saltline;

use Http\Discovery\Psr17FactoryDiscovery;
use Http\Discovery\Psr18ClientDiscovery;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Saltline\Resources\Connections;
use Saltline\Resources\Environment;
use Saltline\Resources\ProviderProxy;
use Saltline\Resources\Sessions;
use Saltline\Resources\Webhooks;

/**
 * Saltline API client. Server-side only, it holds your secret API key.
 * Uses any PSR-18 client; auto-discovered if none is passed.
 */
final class Client
{
    public const BASE_URLS = [
        'production' => 'https://api.saltline.dev/v1',
        'staging' => 'https://api-staging.saltline.dev/v1',
    ];

    public readonly Connections $connections;
    public readonly Sessions $sessions;
    public readonly Webhooks $webhooks;
    public readonly ProviderProxy $proxy;
    public readonly Environment $environment;
    /** Includes /v1. */
    public readonly string $baseUrl;

    /**
     * @param string      $apiKey
     * @param string      $environment 'production' or 'staging'
     * @param string|null $baseUrl     Overrides $environment. Include /v1.
     */
    public function __construct(
        string $apiKey,
        string $environment = 'production',
        ?string $baseUrl = null,
        ?ClientInterface $httpClient = null,
        ?RequestFactoryInterface $requestFactory = null,
        ?StreamFactoryInterface $streamFactory = null,
    ) {
        if (trim($apiKey) === '') {
            throw new \InvalidArgumentException('Saltline: $apiKey is required.');
        }
        if ($baseUrl === null && !isset(self::BASE_URLS[$environment])) {
            throw new \InvalidArgumentException("Saltline: unknown environment '{$environment}' — use production or staging.");
        }

        $this->baseUrl = rtrim($baseUrl ?? self::BASE_URLS[$environment], '/');

        $transport = new Transport(
            $this->baseUrl,
            trim($apiKey),
            $httpClient ?? Psr18ClientDiscovery::find(),
            $requestFactory ?? Psr17FactoryDiscovery::findRequestFactory(),
            $streamFactory ?? Psr17FactoryDiscovery::findStreamFactory(),
        );

        $this->connections = new Connections($transport);
        $this->sessions = new Sessions($transport);
        $this->webhooks = new Webhooks($transport);
        $this->proxy = new ProviderProxy($transport);
        $this->environment = new Environment($transport);
    }
}
