<?php

declare(strict_types=1);

namespace Saltline\Resources;

use Saltline\SaltlineException;
use Saltline\Transport;

/**
 * @phpstan-type Connection array{connectionKey: string, providerKey: string, integrationKey: string, externalUserId?: string|null, providerUserId?: string|null, authType: string, status: string, grantedScopes?: list<mixed>|null, expiresAt?: string|null, lastRefreshedAt?: string|null, lastUsedAt?: string|null, lastError?: string|null, lastErrorAt?: string|null, createdAt: string, updatedAt: string, disconnectedAt?: string|null}
 */
final class Connections
{
    public function __construct(private readonly Transport $transport)
    {
    }

    /**
     * Starts a connection. Keep the PKCE verifier in the user's session, not keyed by connectionKey.
     *
     * @param array{auth: string, redirectUrl: string, codeChallenge: string, codeChallengeMethod: 'S256', externalUserId?: string|null, theme?: string} $body
     *
     * @return array{connectionKey: string, authorizationUrl: string, message?: string}
     *
     * @throws SaltlineException
     */
    public function init(string $provider, array $body, ?string $integrationKey = null): array
    {
        /** @var array{connectionKey: string, authorizationUrl: string, message?: string} */
        return $this->transport->json(
            'POST',
            'connections/' . Transport::segment($provider) . '/init',
            ['x-saltline-integration-key' => $integrationKey],
            body: $body,
        );
    }

    /**
     * Activates the connection. One use only; expires 30 min after the provider step.
     *
     * @return Connection
     *
     * @throws SaltlineException
     */
    public function claim(string $provider, string $connectionKey, string $codeVerifier): array
    {
        $result = $this->transport->json(
            'POST',
            'connections/' . Transport::segment($provider) . '/claim',
            ['x-saltline-connection-key' => $connectionKey],
            body: ['codeVerifier' => $codeVerifier],
        );

        /** @var Connection */
        return $result['connection'];
    }

    /**
     * Refreshes OAuth2 tokens. 409 CONFLICT if a refresh is already running.
     *
     * @return Connection
     *
     * @throws SaltlineException
     */
    public function refresh(string $provider, string $connectionKey): array
    {
        $result = $this->transport->json(
            'POST',
            'connections/' . Transport::segment($provider) . '/refresh',
            ['x-saltline-connection-key' => $connectionKey],
        );

        /** @var Connection */
        return $result['connection'];
    }

    /**
     * Revokes the connection.
     *
     * @throws SaltlineException
     */
    public function revoke(string $provider, string $connectionKey, ?string $integrationKey = null): void
    {
        $this->transport->json(
            'DELETE',
            'connections/' . Transport::segment($provider) . '/revoke',
            [
                'x-saltline-connection-key' => $connectionKey,
                'x-saltline-integration-key' => $integrationKey,
            ],
        );
    }

    /**
     * Lists the integration's connections.
     *
     * @return list<Connection>
     *
     * @throws SaltlineException
     */
    public function list(string $provider, string $integrationKey): array
    {
        $result = $this->transport->json(
            'GET',
            'connections/' . Transport::segment($provider) . '/connections',
            ['x-saltline-integration-key' => $integrationKey],
        );

        /** @var list<Connection> */
        return $result['connections'];
    }
}
