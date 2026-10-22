<?php

declare(strict_types=1);

namespace Saltline;

/**
 * The start and finish endpoints for signing a user in.
 *
 * @phpstan-import-type ProviderOptions from Flow
 */
final class SignInFlow extends Flow
{
    /**
     * @param list<string>|array<string, ProviderOptions> $providers   Allowlist; per-provider 'integrationKey' optional.
     * @param string|\Closure(string): string             $redirectUrl
     * @param 'light'|'dark'|null                         $theme
     */
    public function __construct(
        private readonly Client $saltline,
        array $providers,
        string|\Closure $redirectUrl,
        ?string $theme = null,
    ) {
        parent::__construct($providers, $redirectUrl, $theme);
    }

    protected function keyField(): string
    {
        return 'sessionKey';
    }

    /** @return array{provider: string, sessionKey: string, authorizationUrl: string} */
    protected function init(string $provider, array $options, string $codeChallenge, ?string $externalUserId): array
    {
        $result = $this->saltline->sessions->init($provider, [
            'auth' => 'oAuth2',
            'redirectUrl' => $this->redirectUrl($provider),
            'codeChallenge' => $codeChallenge,
            'codeChallengeMethod' => 'S256',
            'externalUserId' => $externalUserId,
            ...$this->themeField(),
        ], $options['integrationKey'] ?? null);

        return [
            'provider' => $provider,
            'sessionKey' => $result['sessionKey'],
            'authorizationUrl' => $result['authorizationUrl'],
        ];
    }

    /** @return array{provider: string, sessionKey: string, user: array<string, mixed>, raw: array<string, mixed>} */
    protected function claim(string $provider, string $key, string $codeVerifier): array
    {
        $info = $this->saltline->sessions->claim($provider, $key, $codeVerifier);

        return [
            'provider' => $provider,
            'sessionKey' => $key,
            'user' => $info['user'],
            'raw' => $info['raw'],
        ];
    }
}
