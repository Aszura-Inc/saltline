<?php

declare(strict_types=1);

namespace Saltline\Resources;

use Saltline\SaltlineException;
use Saltline\Transport;

/**
 * @phpstan-type Session array{sessionKey: string, providerKey: string, integrationKey: string, externalUserId?: string|null, providerUserId?: string|null, authType: string, status: string, grantedScopes?: list<mixed>|null, expiresAt?: string|null, lastRefreshedAt?: string|null, lastUsedAt?: string|null, lastError?: string|null, lastErrorAt?: string|null, createdAt: string, updatedAt: string, disconnectedAt?: string|null}
 * @phpstan-type UserInfo array{user: array<string, mixed>, raw: array<string, mixed>}
 */
final class Sessions
{
    public function __construct(private readonly Transport $transport)
    {
    }

    /**
     * Starts a sign-in.
     *
     * @param array{auth: 'oAuth2', redirectUrl: string, codeChallenge: string, codeChallengeMethod: 'S256', externalUserId?: string|null, theme?: string} $body
     *
     * @return array{sessionKey: string, authorizationUrl: string, message?: string}
     *
     * @throws SaltlineException
     */
    public function init(string $provider, array $body, ?string $integrationKey = null): array
    {
        /** @var array{sessionKey: string, authorizationUrl: string, message?: string} */
        return $this->transport->json(
            'POST',
            'auth/' . Transport::segment($provider) . '/init',
            ['x-saltline-integration-key' => $integrationKey],
            body: $body,
        );
    }

    /**
     * Returns the signed-in user. One use only; expires 30 min after the provider step.
     *
     * @return UserInfo
     *
     * @throws SaltlineException
     */
    public function claim(string $provider, string $sessionKey, string $codeVerifier): array
    {
        /** @var UserInfo */
        return $this->transport->json(
            'POST',
            'auth/' . Transport::segment($provider) . '/claim',
            ['x-saltline-session-key' => $sessionKey],
            body: ['codeVerifier' => $codeVerifier],
        );
    }

    /**
     * Fetches the user live from the provider.
     *
     * @return UserInfo
     *
     * @throws SaltlineException
     */
    public function userinfo(string $provider, string $sessionKey, ?string $integrationKey = null): array
    {
        /** @var UserInfo */
        return $this->transport->json(
            'POST',
            'auth/' . Transport::segment($provider) . '/userinfo',
            [
                'x-saltline-session-key' => $sessionKey,
                'x-saltline-integration-key' => $integrationKey,
            ],
        );
    }

    /**
     * Refreshes tokens. 409 CONFLICT if a refresh is already running.
     *
     * @return Session
     *
     * @throws SaltlineException
     */
    public function refresh(string $provider, string $sessionKey): array
    {
        $result = $this->transport->json(
            'POST',
            'auth/' . Transport::segment($provider) . '/refresh',
            ['x-saltline-session-key' => $sessionKey],
        );

        /** @var Session */
        return $result['session'];
    }

    /**
     * Revokes the session.
     *
     * @throws SaltlineException
     */
    public function revoke(string $provider, string $sessionKey, ?string $integrationKey = null): void
    {
        $this->transport->json(
            'DELETE',
            'auth/' . Transport::segment($provider) . '/revoke',
            [
                'x-saltline-session-key' => $sessionKey,
                'x-saltline-integration-key' => $integrationKey,
            ],
        );
    }

    /**
     * Lists this provider's sessions.
     *
     * @return list<Session>
     *
     * @throws SaltlineException
     */
    public function list(string $provider, ?string $integrationKey = null): array
    {
        $result = $this->transport->json(
            'GET',
            'auth/' . Transport::segment($provider) . '/sessions',
            ['x-saltline-integration-key' => $integrationKey],
        );

        /** @var list<Session> */
        return $result['sessions'];
    }
}
