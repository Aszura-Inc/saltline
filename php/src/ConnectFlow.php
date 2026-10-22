<?php

declare(strict_types=1);

namespace Saltline;

/**
 * The start and finish endpoints for connecting a user's account.
 *
 * @phpstan-import-type ProviderOptions from Flow
 */
final class ConnectFlow extends Flow
{
    /**
     * @param list<string>|array<string, ProviderOptions> $providers   Allowlist; per-provider 'auth' and 'integrationKey' optional.
     * @param string|\Closure(string): string             $redirectUrl
     * @param string                                      $auth        Default auth type for every provider.
     * @param 'light'|'dark'|null                         $theme
     */
    public function __construct(
        private readonly Client $saltline,
        array $providers,
        string|\Closure $redirectUrl,
        private readonly string $auth = 'oAuth2',
        ?string $theme = null,
    ) {
        parent::__construct($providers, $redirectUrl, $theme);
    }

    protected function keyField(): string
    {
        return 'connectionKey';
    }

    /** @return array{provider: string, connectionKey: string, authorizationUrl: string} */
    protected function init(string $provider, array $options, string $codeChallenge, ?string $externalUserId): array
    {
        $result = $this->saltline->connections->init($provider, [
            'auth' => $options['auth'] ?? $this->auth,
            'redirectUrl' => $this->redirectUrl($provider),
            'codeChallenge' => $codeChallenge,
            'codeChallengeMethod' => 'S256',
            'externalUserId' => $externalUserId,
            ...$this->themeField(),
        ], $options['integrationKey'] ?? null);

        return [
            'provider' => $provider,
            'connectionKey' => $result['connectionKey'],
            'authorizationUrl' => $result['authorizationUrl'],
        ];
    }

    /** @return array{provider: string, connectionKey: string, connection: array<string, mixed>} */
    protected function claim(string $provider, string $key, string $codeVerifier): array
    {
        return [
            'provider' => $provider,
            'connectionKey' => $key,
            'connection' => $this->saltline->connections->claim($provider, $key, $codeVerifier),
        ];
    }
}
