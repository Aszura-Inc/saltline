<?php

declare(strict_types=1);

namespace Saltline;

/** PKCE pair: challenge goes to init(), verifier to claim(). */
final class Pkce
{
    /** @return array{codeVerifier: string, codeChallenge: string, codeChallengeMethod: 'S256'} */
    public static function create(): array
    {
        $codeVerifier = self::base64Url(random_bytes(32));

        return [
            'codeVerifier' => $codeVerifier,
            'codeChallenge' => self::base64Url(hash('sha256', $codeVerifier, true)),
            'codeChallengeMethod' => 'S256',
        ];
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
