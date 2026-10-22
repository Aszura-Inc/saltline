# @aszura/saltline-browser

The browser half of Saltline's connect and sign-in flows. It makes the PKCE pair when the user
clicks, keeps the verifier in that tab, sends the user to the provider, and hands the verifier back
to your server when they return. Under 3 KB gzipped, no dependencies, any framework or none, with
optional [React bindings](#react).

**It never talks to Saltline.** Your secret API key stays on your server, which calls `init` and
`claim` with [`saltline/php`](../README.md#php) or [`@aszura/saltline-node`](../node/README.md). The
package only calls two endpoints you write: one to start, one to finish.

```
click ─▶ start(): PKCE pair ─▶ POST /saltline/start { codeChallenge }  ─▶ your server: init()
                                  ◀─ { authorizationUrl, connectionKey } ◀─
         verifier ─▶ sessionStorage, then ─▶ provider consent ─▶ back to your redirectUrl
redirect ─▶ finish(): ─▶ POST /saltline/finish { connectionKey, codeVerifier } ─▶ your server: claim()
```

## Install

```sh
npm install @aszura/saltline-browser
```

Or with no build step, from a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@aszura/saltline-browser@0.1.0/dist/saltline.min.js"></script>
```

## Start: a button

```html
<button data-saltline-start="/saltline/start" data-saltline-provider="google">Connect Google</button>
```

With the `<script>` build, that's all. Every other `data-saltline-*` attribute becomes a field in
the JSON body (`data-saltline-integration-key` → `integrationKey`). While the request runs the
button has `aria-busy="true"`; a failure fires a bubbling `saltline:error` event with the error as
`detail`.

From a bundle, call `bind()` once the buttons are on the page, or call `start` yourself:

```ts
import { start } from '@aszura/saltline-browser';

button.addEventListener('click', () =>
  start({ url: '/saltline/start', body: { provider: 'google' } }).catch(showError),
);
```

`start` POSTs `{ ...body, codeChallenge, codeChallengeMethod }` with your cookies (`credentials`
defaults to `same-origin`; add a CSRF token through `headers`). Your endpoint answers with init's
`authorizationUrl` and `connectionKey` (or `sessionKey`). The package stores the verifier under that
key and navigates there. It will only navigate to an `http(s)` URL.

## Finish: the page at your redirectUrl

```ts
import { finish } from '@aszura/saltline-browser';

const result = await finish({ url: '/saltline/finish' });
if (result === null) {
  // not a Saltline redirect — an ordinary visit to this page
} else if (result.ok) {
  // your endpoint claimed it; result.data is its JSON answer
} else {
  // the user declined, or the provider failed: result.error, result.errorMessage
}
```

`finish` reads `?connectionKey=` / `?sessionKey=` / `?error=` from the URL, removes them from the
address bar, takes the verifier for that key out of storage, and POSTs
`{ connectionKey, codeVerifier }` (or `{ sessionKey, codeVerifier }`) to your endpoint. It's safe
to call on every load of the page.

With the `<script>` build, put the endpoint on the tag and listen for the outcome:

```html
<script src="…/saltline.min.js" data-finish="/saltline/finish"></script>
<script>
  document.addEventListener('saltline:finished', (e) => {
    if (e.detail.ok) location.replace('/settings/integrations');
    else showError(e.detail.errorMessage);
  });
  document.addEventListener('saltline:error', (e) => showError(e.detail.message));
</script>
```

## React

`@aszura/saltline-browser/react` wraps the same two steps. React 16.8+ is an optional peer dependency;
nothing React-related loads unless you import this path.

```tsx
import { SaltlineButton, useSaltlineFinish } from '@aszura/saltline-browser/react';

function ConnectGoogle() {
  return (
    <SaltlineButton
      url="/saltline/start"
      body={{ provider: 'google' }}
      onError={(error) => toast(error instanceof Error ? error.message : 'Could not connect')}
    >
      Connect Google
    </SaltlineButton>
  );
}

// The page at your redirectUrl:
function Connected() {
  const { loading, result, error } = useSaltlineFinish<{ connected: boolean }>({
    url: '/saltline/finish',
  });
  if (loading) return <p>Finishing up…</p>;
  if (error) return <p>Something went wrong. Please try connecting again.</p>;
  if (result?.ok === false) return <p>{result.errorMessage ?? 'The connection was cancelled.'}</p>;
  if (result?.ok) return <Navigate to="/settings/integrations" />;
  return null; // an ordinary visit, not a Saltline redirect
}
```

- **`SaltlineButton`** is a `<button>` that runs `start` on click. It is disabled and
  `aria-busy` while the request runs and the page leaves, and passes every other prop through.
  An `onClick` that calls `preventDefault()` stops it.
- **`useSaltlineStart(options)`** returns `{ start(body?), pending, error }`, for your own button
  or menu item. `start` never throws: a failure lands in `error` and `onError`.
- **`useSaltlineFinish(options)`** runs `finish` once on mount and returns
  `{ loading, result, error }`, with `result` as `finish` returns it. Pass `enabled: false` to
  wait, for example until your own session has loaded. It runs once per mount even under
  StrictMode, whose second run would find the verifier already used.

## Your two endpoints

Both run behind your own login, so you know which user is connecting. **Set `auth`, `redirectUrl`
and the provider on the server**, and check any provider the browser sends against your own list;
take only the challenge (and that choice) from the request. Answer `start` with
`authorizationUrl` and the key, and nothing else.

```php
// POST /saltline/start
$in = json_decode(file_get_contents('php://input'), true);
$provider = in_array($in['provider'] ?? null, ['google', 'trello'], true) ? $in['provider'] : null;
if ($provider === null) { http_response_code(400); exit; }
$result = $saltline->connections->init($provider, [
    'auth' => 'oAuth2',
    'redirectUrl' => 'https://yourapp.com/connected',
    'codeChallenge' => $in['codeChallenge'],
    'codeChallengeMethod' => 'S256',
    'externalUserId' => (string) $currentUser->id,
]);
$_SESSION['saltline_provider'] = $provider;
echo json_encode(['authorizationUrl' => $result['authorizationUrl'], 'connectionKey' => $result['connectionKey']]);

// POST /saltline/finish
$in = json_decode(file_get_contents('php://input'), true);
$connection = $saltline->connections->claim($_SESSION['saltline_provider'], $in['connectionKey'], $in['codeVerifier']);
// store $connection['connectionKey'] against $currentUser
echo json_encode(['connected' => true]);
```

```ts
// Express, with @aszura/saltline-node
app.post('/saltline/start', requireLogin, async (req, res) => {
  const provider = ALLOWED.has(req.body.provider) ? req.body.provider : null;
  if (!provider) return res.sendStatus(400);
  const { authorizationUrl, connectionKey } = await saltline.connections.init(provider, {
    auth: 'oAuth2',
    redirectUrl: 'https://yourapp.com/connected',
    codeChallenge: req.body.codeChallenge,
    codeChallengeMethod: 'S256',
    externalUserId: req.user.id,
  });
  req.session.saltlineProvider = provider;
  res.json({ authorizationUrl, connectionKey });
});

app.post('/saltline/finish', requireLogin, async (req, res) => {
  const connection = await saltline.connections.claim(
    req.session.saltlineProvider,
    req.body.connectionKey,
    req.body.codeVerifier,
  );
  // store connection.connectionKey against req.user
  res.json({ connected: true });
});
```

Sign-in works the same way with `sessions.init` / `sessions.claim`. Your start endpoint answers
with `sessionKey` instead of `connectionKey`, and `finish` sends `sessionKey`.

## Things to know

- **Same tab, start to finish.** `sessionStorage` belongs to one tab, so the flow has to come back
  to the tab that started it, which a normal redirect does. A link opened in a new tab, or a
  different browser, ends in `VERIFIER_NOT_FOUND`: start again.
- **One use.** `finish` deletes the verifier before calling your endpoint, so a reload or a copied
  URL can't replay it. If your finish endpoint fails, start the flow again.
- **Abandoned flows clean up.** Verifiers older than an hour are dropped the next time `start` runs.

## Errors

`start` and `finish` throw `SaltlineError` for failures on the browser side. Branch on `code`:

| `code` | Meaning |
| --- | --- |
| `START_FAILED` | Your start endpoint answered non-2xx or couldn't be reached. `status` and `body` hold its answer. |
| `INVALID_START_RESPONSE` | Its answer had no `http(s)` `authorizationUrl`, or no `connectionKey`/`sessionKey`. |
| `FINISH_FAILED` | Your finish endpoint answered non-2xx or couldn't be reached. |
| `STORAGE_UNAVAILABLE` | `sessionStorage` is blocked (some private modes, sandboxed iframes). |
| `VERIFIER_NOT_FOUND` | This tab didn't start a flow for the key in the URL. |

A provider-side failure isn't thrown: `finish` returns `{ ok: false, error, errorMessage }`.

## Lower-level pieces

`createPkce()` makes a pair with Web Crypto and `parseRedirect(url)` reads the return URL, if you'd
rather build the flow yourself.

## License

MIT
