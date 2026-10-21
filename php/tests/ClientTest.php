<?php

declare(strict_types=1);

namespace Saltline\Tests;

use GuzzleHttp\Psr7\HttpFactory;
use PHPUnit\Framework\TestCase;
use Saltline\Client;
use Saltline\ConnectionRedirect;
use Saltline\Pkce;
use Saltline\SaltlineException;

final class ClientTest extends TestCase
{
    private static function client(FakeHttpClient $http): Client
    {
        $factory = new HttpFactory();

        return new Client('sk_test_01ENV', 'staging', httpClient: $http, requestFactory: $factory, streamFactory: $factory);
    }

    /** @return array<string, mixed> */
    private static function connection(): array
    {
        return [
            'connectionKey' => 'ck',
            'providerKey' => 'google',
            'integrationKey' => 'primary',
            'authType' => 'oAuth2',
            'status' => 'active',
            'createdAt' => '2026-10-21T00:00:00Z',
            'updatedAt' => '2026-10-21T00:00:00Z',
        ];
    }

    public function testRequiresAnApiKey(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Client('  ', httpClient: new FakeHttpClient(), requestFactory: new HttpFactory(), streamFactory: new HttpFactory());
    }

    public function testRejectsAnUnknownEnvironment(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Client('k', 'prod', httpClient: new FakeHttpClient(), requestFactory: new HttpFactory(), streamFactory: new HttpFactory());
    }

    public function testFindsAnInstalledHttpClientWhenNoneIsPassed(): void
    {
        // Guzzle is a dev dependency here, so discovery has something to find.
        self::assertSame('https://api.saltline.dev/v1', (new Client('k'))->baseUrl);
        self::assertSame('http://localhost:8787/v1', (new Client('k', baseUrl: 'http://localhost:8787/v1/'))->baseUrl);
    }

    public function testConnectionsInitPostsTheBodyWithApiKeyAndIntegrationKey(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, ['connectionKey' => 'ck', 'authorizationUrl' => 'https://provider/auth']));

        $body = ['auth' => 'oAuth2', 'redirectUrl' => 'https://app.test/back', 'codeChallenge' => 'challenge', 'codeChallengeMethod' => 'S256'];
        $result = self::client($http)->connections->init('google-calendar', $body, integrationKey: 'primary');

        self::assertSame(['connectionKey' => 'ck', 'authorizationUrl' => 'https://provider/auth'], $result);
        $request = $http->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame('https://api-staging.saltline.dev/v1/connections/google-calendar/init', (string) $request->getUri());
        self::assertSame('Bearer sk_test_01ENV', $request->getHeaderLine('Authorization'));
        self::assertSame('primary', $request->getHeaderLine('x-saltline-integration-key'));
        self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
        self::assertSame($body, $http->body(0));
    }

    public function testConnectionsClaimSendsTheKeyAsAHeaderAndTheVerifierInTheBody(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, ['connection' => self::connection()]));

        self::assertSame(self::connection(), self::client($http)->connections->claim('google', 'ck', 'verifier'));
        $request = $http->requests[0];
        self::assertSame('POST', $request->getMethod());
        self::assertSame('https://api-staging.saltline.dev/v1/connections/google/claim', (string) $request->getUri());
        self::assertSame('ck', $request->getHeaderLine('x-saltline-connection-key'));
        self::assertSame(['codeVerifier' => 'verifier'], $http->body(0));
    }

    public function testConnectionsClaimSurfacesAVerifierMismatch(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(
            403,
            ['error' => "The codeVerifier doesn't match.", 'code' => 'CODE_VERIFIER_MISMATCH'],
            ['x-saltline-error-code' => 'CODE_VERIFIER_MISMATCH'],
        ));

        try {
            self::client($http)->connections->claim('google', 'ck', 'wrong');
            self::fail('expected SaltlineException');
        } catch (SaltlineException $error) {
            self::assertSame('CODE_VERIFIER_MISMATCH', $error->errorCode);
            self::assertSame(403, $error->status);
        }
    }

    public function testOmitsHeadersThatWereNotGiven(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, ['connectionKey' => 'ck', 'authorizationUrl' => 'u']));
        self::client($http)->connections->init('google', ['auth' => 'oAuth2', 'redirectUrl' => 'https://x.test', 'codeChallenge' => 'c', 'codeChallengeMethod' => 'S256']);

        self::assertFalse($http->requests[0]->hasHeader('x-saltline-integration-key'));
    }

    public function testKeysTravelInHeadersNeverTheBody(): void
    {
        $session = [...self::connection(), 'sessionKey' => 'sk'];
        unset($session['connectionKey']);
        $http = new FakeHttpClient(
            FakeHttpClient::json(200, ['connection' => self::connection()]),
            FakeHttpClient::json(200, ['revoked' => true]),
            FakeHttpClient::json(200, ['session' => $session]),
        );
        $saltline = self::client($http);

        self::assertSame(self::connection(), $saltline->connections->refresh('google', 'ck'));
        $saltline->connections->revoke('google', 'ck');
        $saltline->sessions->refresh('google', 'sk');

        self::assertStringEndsWith('/connections/google/refresh', (string) $http->requests[0]->getUri());
        self::assertSame('ck', $http->requests[0]->getHeaderLine('x-saltline-connection-key'));
        self::assertNull($http->body(0));
        self::assertSame('DELETE', $http->requests[1]->getMethod());
        self::assertSame('ck', $http->requests[1]->getHeaderLine('x-saltline-connection-key'));
        self::assertStringEndsWith('/auth/google/refresh', (string) $http->requests[2]->getUri());
        self::assertSame('sk', $http->requests[2]->getHeaderLine('x-saltline-session-key'));
    }

    public function testClaimSendsTheSessionKeyAsAHeaderAndTheVerifierInTheBody(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, ['user' => ['email' => 'a@b.test'], 'raw' => new \stdClass()]));
        $user = self::client($http)->sessions->claim('google', 'sk', 'verifier');

        self::assertSame(['email' => 'a@b.test'], $user['user']);
        self::assertSame('sk', $http->requests[0]->getHeaderLine('x-saltline-session-key'));
        self::assertSame(['codeVerifier' => 'verifier'], $http->body(0));
    }

    public function testWebhookRegisterSendsAnObjectBodyEvenWhenEmpty(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, ['success' => true, 'webhookKey' => 'wk']));
        self::client($http)->webhooks->register('asana', 'ck', kind: 'tasks', metadata: 'm');

        self::assertSame('{}', (string) $http->requests[0]->getBody());
        self::assertSame('tasks', $http->requests[0]->getHeaderLine('x-saltline-webhook-kind'));
        self::assertSame('m', $http->requests[0]->getHeaderLine('x-saltline-metadata'));
    }

    public function testEncodesPathSegmentsSoAKeyCannotChangeTheRoute(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, [
            'webhook' => ['webhookKey' => 'a/b', 'status' => 'active', 'createdAt' => 'x', 'updatedAt' => 'x'],
        ]));
        self::client($http)->webhooks->get('trello', 'a/b', 'ck');

        self::assertSame('https://api-staging.saltline.dev/v1/webhooks/trello/a%2Fb', (string) $http->requests[0]->getUri());
    }

    public function testTurnsASaltlineErrorIntoAnExceptionWithCodeAndRequestId(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(
            401,
            ['error' => 'Your API key has expired.', 'code' => 'API_KEY_EXPIRED'],
            ['x-saltline-error-code' => 'API_KEY_EXPIRED', 'x-saltline-request-id' => 'req_1'],
        ));

        try {
            self::client($http)->environment->integrations();
            self::fail('expected SaltlineException');
        } catch (SaltlineException $error) {
            self::assertSame('API_KEY_EXPIRED', $error->errorCode);
            self::assertSame(401, $error->status);
            self::assertSame('req_1', $error->requestId);
        }
    }

    public function testProxyRelaysAProviderErrorInsteadOfThrowing(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(404, ['error' => 'board not found']));
        $response = self::client($http)->proxy->request(
            'GET',
            'trello',
            '/1/boards/abc',
            'ck',
            query: ['fields' => 'name'],
            headers: ['Accept' => 'application/json'],
            version: '1',
        );

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('{"error":"board not found"}', (string) $response->getBody());
        $request = $http->requests[0];
        self::assertSame('https://api-staging.saltline.dev/v1/proxy/trello/1/boards/abc?fields=name', (string) $request->getUri());
        self::assertSame('application/json', $request->getHeaderLine('Accept'));
        self::assertSame('1', $request->getHeaderLine('x-saltline-version'));
    }

    public function testProxyThrowsOnSaltlinesOwnRefusal(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(
            404,
            ['error' => 'No such connection.', 'code' => 'CONNECTION_NOT_FOUND'],
            ['x-saltline-error-code' => 'CONNECTION_NOT_FOUND'],
        ));

        $this->expectException(SaltlineException::class);
        self::client($http)->proxy->request('GET', 'trello', '1/boards/abc', 'ck');
    }

    public function testProxyDropsCallerSaltlineHeadersWhateverTheirCase(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(200, []));
        self::client($http)->proxy->request('GET', 'trello', '1/me', 'right', headers: [
            'X-Saltline-Connection-Key' => 'wrong',
            'X-Saltline-Callback-Url' => 'https://evil.test',
            'Accept' => 'application/json',
        ]);

        $request = $http->requests[0];
        self::assertSame('right', $request->getHeaderLine('x-saltline-connection-key'));
        self::assertFalse($request->hasHeader('x-saltline-callback-url'));
        self::assertSame('application/json', $request->getHeaderLine('Accept'));
    }

    public function testEnqueueSendsTheCallbackUrlAndReturnsTheRequestId(): void
    {
        $http = new FakeHttpClient(FakeHttpClient::json(202, ['requestId' => 'req_9']));
        $result = self::client($http)->proxy->enqueue('POST', 'trello', '1/boards', 'ck', 'https://app.test/callback', body: ['name' => 'New']);

        self::assertSame(['requestId' => 'req_9'], $result);
        self::assertSame('https://app.test/callback', $http->requests[0]->getHeaderLine('x-saltline-callback-url'));
        self::assertSame(['name' => 'New'], $http->body(0));
    }

    public function testProxyRejectsAnEmptyOrTraversingPathBeforeAnyRequest(): void
    {
        $http = new FakeHttpClient();
        $saltline = self::client($http);

        foreach (['/', '1/../admin'] as $path) {
            try {
                $saltline->proxy->request('GET', 'trello', $path, 'ck');
                self::fail("expected {$path} to be rejected");
            } catch (\InvalidArgumentException) {
            }
        }
        self::assertCount(0, $http->requests);
    }

    public function testPkceReturnsAnS256ChallengeOfTheVerifier(): void
    {
        $pkce = Pkce::create();

        self::assertSame(
            rtrim(strtr(base64_encode(hash('sha256', $pkce['codeVerifier'], true)), '+/', '-_'), '='),
            $pkce['codeChallenge'],
        );
        self::assertSame('S256', $pkce['codeChallengeMethod']);
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $pkce['codeVerifier']);
    }

    public function testConnectionRedirectReadsSuccessAndFailure(): void
    {
        $ok = ConnectionRedirect::parse('https://app.test/back?connectionKey=ck');
        self::assertTrue($ok->ok);
        self::assertSame('ck', $ok->connectionKey);

        $failed = ConnectionRedirect::parse('https://app.test/back?error=auth_error&error_message=Denied');
        self::assertFalse($failed->ok);
        self::assertSame('auth_error', $failed->error);
        self::assertSame('Denied', $failed->errorMessage);

        $missing = ConnectionRedirect::parse('https://app.test/back');
        self::assertFalse($missing->ok);
        self::assertSame('missing_connection_key', $missing->error);
    }
}
