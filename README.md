# Saltline SDKs

Clients for the [Saltline API](https://api.saltline.dev): connect your users'
third-party accounts, call those APIs through Saltline, manage provider webhooks and sign users in —
without handling their credentials yourself.

| Language | Package | Folder |
| --- | --- | --- |
| PHP 8.1+ | [`saltline/php`](https://packagist.org/packages/saltline/php) | [`php/`](php/) |
| Node.js 20+ | [`@aszura/saltline-node`](https://www.npmjs.com/package/@aszura/saltline-node) | [`node/`](node/) |
| Browser (+ React) | [`@aszura/saltline-browser`](https://www.npmjs.com/package/@aszura/saltline-browser) | [`browser/`](browser/) |

The server SDKs are generated against the same contract, [`openapi.yaml`](openapi.yaml), and tested against
the same fixtures in [`tests/fixtures`](tests/fixtures), so they behave the same way.

The PHP and Node SDKs hold your secret API key: use them on your server only, never in a browser or
app. `@aszura/saltline-browser` is the other half of the connect and sign-in flows: it makes the PKCE pair
in the browser and talks only to your own backend, never to Saltline.

## PHP

```sh
composer require saltline/php
```

Bring any PSR-18 HTTP client (Guzzle, Symfony HttpClient, …); one installed in your project is found
automatically.

```php
$saltline = new Saltline\Client(apiKey: getenv('SALTLINE_API_KEY'));

// Connecting uses PKCE: keep the verifier in this user's session, never in a store looked up by
// connectionKey. The connection only goes live once you claim it with that verifier.
$pkce = Saltline\Pkce::create();
$result = $saltline->connections->init('google', [
    'auth' => 'oAuth2',
    'redirectUrl' => 'https://yourapp.com/connected',
    'codeChallenge' => $pkce['codeChallenge'],
    'codeChallengeMethod' => $pkce['codeChallengeMethod'],
]);
$_SESSION['saltline_connect'] = $pkce['codeVerifier'];
// Send the user to $result['authorizationUrl']. They come back to your redirectUrl:

$redirect = Saltline\ConnectionRedirect::parse($requestUrl);
$codeVerifier = $_SESSION['saltline_connect'] ?? null;
unset($_SESSION['saltline_connect']); // one use only
if ($redirect->ok && $codeVerifier !== null) {
    $connection = $saltline->connections->claim('google', $redirect->connectionKey, $codeVerifier);
    // store $connection['connectionKey'] against your user — it's active now
}

// Call the provider's API — you get its response exactly as it sent it.
$response = $saltline->proxy->request('GET', 'trello', '1/members/me/boards', $connection['connectionKey']);

// Verify a webhook delivery — use the raw body.
$valid = Saltline\Signature::verifyWebhook(getallheaders(), file_get_contents('php://input'), $secret);
```

Errors Saltline itself returns throw `Saltline\SaltlineException`; branch on `$e->errorCode`, never
on the message.

## Node.js

See [`node/README.md`](node/README.md).

## Developing

```sh
composer install && composer test           # PHP
cd node && npm install && npm test           # Node
cd browser && npm install && npm test        # Browser
```

`openapi.yaml` is copied from the Saltline API (`apps/saltline-api/openapi.yaml` in the workers
repo). After updating it, regenerate the Node types with
`npm run openapi:types` in `node/`; `npm run openapi:check` fails while they're stale. All three
packages are released together under one version: tag `vX.Y.Z` (Packagist reads the tag) and
publish `@aszura/saltline-node@X.Y.Z` from `node/` and `@aszura/saltline-browser@X.Y.Z` from `browser/`.

## License

MIT
