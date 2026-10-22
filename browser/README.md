# @aszura/saltline-browser

The browser half of Saltline's connect and sign-in flows. It makes the PKCE pair when the user
clicks, keeps the verifier in that tab, sends the user to the provider, and hands the verifier back
to your server when they return. Under 3 KB gzipped, no dependencies, any framework or none, with
optional [React bindings](#react).

**It never talks to Saltline.** Your secret API key stays on your server, which calls `init` and
`claim` with [`@aszura/saltline-node`](../node/README.md) or [`saltline/php`](../README.md#php). The
package only calls two endpoints on your backend, and both SDKs ship those endpoints
[ready to mount](#your-two-endpoints).

```
click ─▶ start(): PKCE pair ─▶ POST /saltline/start { provider, codeChallenge } ─▶ your server: init()
                                  ◀─ { authorizationUrl, connectionKey } ◀─
         verifier + provider + state ─▶ sessionStorage, then ─▶ provider consent ─▶ back to your redirectUrl
redirect ─▶ finish(): ─▶ POST /saltline/finish { provider, connectionKey, codeVerifier } ─▶ your server: claim()
```

## Install

```sh
npm install @aszura/saltline-browser
```

Or with no build step, from a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@aszura/saltline-browser@0.3.0/dist/saltline.min.js"></script>
```

## Start: a button

```html
<button data-saltline-start="/saltline/start" data-saltline-provider="google">Connect Google</button>
```

With the `<script>` build, that's all. `data-saltline-provider` is the provider,
`data-saltline-state` is your [state](#state-your-own-context-across-the-redirect), and every other
`data-saltline-*` attribute becomes a field in the JSON body (`data-saltline-integration-key` →
`integrationKey`). While the request runs the button has `aria-busy="true"`; a failure fires a
bubbling `saltline:error` event with the error as `detail`.

From a bundle, call `bind()` once the buttons are on the page, or call `start` yourself:

```ts
import { start } from '@aszura/saltline-browser';

button.addEventListener('click', () =>
  start({ url: '/saltline/start', provider: 'google' }).catch(showError),
);
```

`start` POSTs `{ ...body, provider, codeChallenge, codeChallengeMethod }` with your cookies
(`credentials` defaults to `same-origin`; add a CSRF token through `headers`). Your endpoint answers
with init's `authorizationUrl` and `connectionKey` (or `sessionKey`). The package stores the
verifier, the provider and your state under that key and navigates there. It will only navigate to
an `http(s)` URL.

## Finish: the page at your redirectUrl

```ts
import { finish } from '@aszura/saltline-browser';

const result = await finish({ url: '/saltline/finish' });
if (result === null) {
  // not a Saltline redirect — an ordinary visit to this page
} else if (result.ok) {
  // your endpoint claimed it: result.provider, result.data (its JSON answer), result.state
} else {
  // the user declined, or the provider failed: result.error, result.errorMessage, result.state
}
```

`finish` reads `?connectionKey=` / `?sessionKey=` / `?error=` from the URL, removes them from the
address bar, takes the pending flow for that key out of storage, and POSTs
`{ provider, connectionKey, codeVerifier }` (or `{ provider, sessionKey, codeVerifier }`) to your
endpoint. Your server needs the provider for `claim`, and it's the one `start` was given, so your
endpoint never has to remember it. `finish` is safe to call on every load of the page.

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

### State: your own context across the redirect

Anything JSON you pass `start` as `state` comes back from `finish` as `result.state`, in this tab
only, never sent anywhere. Use it for "go back to the Integrations tab" or "this was the Gmail
button":

```ts
await start({ url: '/saltline/start', provider: 'google', state: { returnTo: '/settings?tab=mail' } });

// at your redirectUrl:
const result = await finish<{ connected: boolean }, { returnTo: string }>({ url: '/saltline/finish' });
if (result?.ok) location.replace(result.state.returnTo);
```

A declined or failed redirect carries no key, so there `state` comes from the flow this tab
started last (and is `undefined` if there was none).

### Routers: cleaning the URL

By default `finish` strips Saltline's params with `history.replaceState`, which React Router,
Next.js and similar routers don't notice. Give `cleanUrl` a function and it hands you the clean
path (with the remaining search and hash) to replace through your router instead:

```ts
// React Router
finish({ url: '/saltline/finish', cleanUrl: (path) => navigate(path, { replace: true }) });
// Next.js App Router (in a 'use client' component)
finish({ url: '/saltline/finish', cleanUrl: (path) => router.replace(path) });
```

`cleanUrl: false` leaves the address bar alone. It also stays untouched when you pass `location`.

## React

`@aszura/saltline-browser/react` wraps the same two steps. React 16.8+ is an optional peer dependency;
nothing React-related loads unless you import this path.

```tsx
import { SaltlineButton, useSaltlineFinish } from '@aszura/saltline-browser/react';

function ConnectGoogle() {
  return (
    <SaltlineButton
      url="/saltline/start"
      provider="google"
      state={{ returnTo: '/settings/integrations' }}
      onError={(error) => toast(error instanceof Error ? error.message : 'Could not connect')}
    >
      Connect Google
    </SaltlineButton>
  );
}

// The page at your redirectUrl:
function Connected() {
  const navigate = useNavigate();
  const { loading, result, error } = useSaltlineFinish<{ connected: boolean }, { returnTo: string }>({
    url: '/saltline/finish',
    cleanUrl: (path) => navigate(path, { replace: true }),
  });
  if (loading) return <p>Finishing up…</p>;
  if (error) return <p>Something went wrong. Please try connecting again.</p>;
  if (result?.ok === false) return <p>{result.errorMessage ?? 'The connection was cancelled.'}</p>;
  if (result?.ok) return <Navigate to={result.state.returnTo} />;
  return null; // an ordinary visit, not a Saltline redirect
}
```

- **`SaltlineButton`** is a `<button>` that runs `start` on click with its `provider`, `state` and
  `body`. It is disabled and `aria-busy` while the request runs and the page leaves, and passes
  every other prop through. An `onClick` that calls `preventDefault()` stops it.
- **`useSaltlineStart(options)`** returns `{ start(provider, { state?, body? }), pending, error }`,
  for your own button or a menu of providers. `start` never throws: a failure lands in `error`
  and `onError`.
- **`useSaltlineFinish(options)`** runs `finish` once on mount and returns
  `{ loading, result, error }`, with `result` as `finish` returns it. Pass `enabled: false` to
  wait, for example until your own session has loaded. It runs once per mount even under
  StrictMode, whose second run would find the verifier already used.
- **Next.js App Router:** both hooks read `sessionStorage` and the address bar, so the component
  that uses them must be a client component (`'use client'` at the top of the file). Pass
  `cleanUrl: (path) => router.replace(path)` from `useRouter` in `next/navigation`.

## Your two endpoints

Both run behind your own login, so you know which user is connecting. The server SDKs ship the
pair, so you don't write them: give an allowlist of providers and the `redirectUrl`, and the
handlers check the input, call `init` and `claim`, and answer exactly what this package expects.

```ts
// Express, with @aszura/saltline-node
import { Saltline, connectFlow } from '@aszura/saltline-node';

const saltline = new Saltline({ apiKey: process.env.SALTLINE_API_KEY! });
const connect = connectFlow(saltline, {
  providers: ['google', 'trello'],
  redirectUrl: 'https://yourapp.com/connected',
});

app.post('/saltline/start', requireLogin, connect.express.start((req) => ({ externalUserId: req.user.id })));
app.post('/saltline/finish', requireLogin, connect.express.finish(async ({ connection }, req) => {
  await db.saveConnection(req.user.id, connection.connectionKey);
  return { connected: true }; // becomes result.data in the browser
}));
```

```ts
// Next.js App Router, Remix, Hono, SvelteKit, Workers: Request in, Response out
// app/saltline/start/route.ts
export const POST = connect.web.start(async (request) => ({ externalUserId: (await currentUser(request)).id }));
// app/saltline/finish/route.ts
export const POST = connect.web.finish(async ({ connection }, request) => {
  const user = await currentUser(request); // throw a Response to answer 401 or redirect
  await db.saveConnection(user.id, connection.connectionKey);
  return { connected: true };
});
```

```php
// PHP
$connect = new Saltline\ConnectFlow($saltline, ['google', 'trello'], 'https://yourapp.com/connected');

// POST /saltline/start
$connect->serveStart(externalUserId: (string) $user->id);
// POST /saltline/finish
$connect->serveFinish(function (array $claimed) use ($user) {
    saveConnection($user->id, $claimed['connection']['connectionKey']);
    return ['connected' => true];
});
```

Sign-in works the same way with `signInFlow` / `Saltline\SignInFlow`: the start endpoint answers
`sessionKey`, `finish` sends `sessionKey`, and the claim result has `user` and `raw`.

Bad input (a provider outside the allowlist, a missing field) is answered 400 with a `code`; a
claim Saltline refuses (expired, reused, wrong verifier) is 400 with Saltline's code; any other
Saltline error is 502. In the browser each is a `FINISH_FAILED` / `START_FAILED` whose `status`
and `body` carry that answer. See the [Node](../node/README.md#serve-the-browser-package) and
[PHP](../php/llms.txt) docs for Laravel, Symfony and the lower-level `start` / `finish` calls.

### Writing them yourself

On another stack, the contract is:

- **Start** receives `{ provider, codeChallenge, codeChallengeMethod: 'S256', ...body }`. Check
  `provider` against your own list, call `init` with your `auth` and `redirectUrl`, and answer
  `{ authorizationUrl, connectionKey }` (or `sessionKey`).
- **Finish** receives `{ provider, connectionKey, codeVerifier, ...body }` (or `sessionKey`), calls
  `claim(provider, key, codeVerifier)`, stores the result against the logged-in user, and answers
  any JSON. That answer becomes `result.data`.

`body` on `start` and `finish` adds fields beside those; `provider`, the key and `codeVerifier`
always win over a field of the same name.

### Through your own HTTP client: `send`

If your app already has an API client (bearer tokens, refresh, a different method, a `{ data }`
envelope), pass `send` instead of `url`. The package hands it the payload it would have POSTed and
expects the endpoint's JSON back. You adapt the request and unwrap the answer, and the package
still does PKCE, storage, validation, URL cleanup and errors:

```ts
// GET with query params, answer wrapped in { data: { authUrl, sessionKey } }
await start({
  provider,
  send: (p) =>
    api
      .get(`auth/${p.provider}`, { params: { redirect: p.redirect, codeChallenge: p.codeChallenge } })
      .then((r) => ({ authorizationUrl: r.data.data.authUrl, sessionKey: r.data.data.sessionKey })),
  body: { redirect: '/signed-in' },
});

// POST through an authed client
await finish({ send: (p) => api.post('auth', p).then((r) => r.data) });
```

- `start`'s `send` must resolve `{ authorizationUrl, connectionKey }` (or `sessionKey`) at the top
  level, and the `http(s)`-only check on `authorizationUrl` applies exactly as with `url`.
- `finish`'s `send` resolves whatever you want as `result.data`.
- `send` replaces `url`, `headers`, `credentials` and `fetch`. TypeScript won't accept them
  together. `SaltlineButton` and `useSaltlineStart` take `send` too, and the button keeps it off
  the DOM.
- `useSaltlineFinish` still runs once per mount when `send` is an inline arrow that changes every
  render.
- The `data-saltline-start` buttons, `bind()` and the script tag's `data-finish` are `url` only,
  because a function can't go in an attribute. Call `start` / `finish` yourself to use `send`.

## Things to know

- **Same tab, start to finish.** `sessionStorage` belongs to one tab, so the flow has to come back
  to the tab that started it, which a normal redirect does. A link opened in a new tab, or a
  different browser, ends in `VERIFIER_NOT_FOUND`: start again.
- **One use.** `finish` deletes the pending flow before calling your endpoint, so a reload or a
  copied URL can't replay it. If your finish endpoint fails, start the flow again.
- **Abandoned flows clean up.** Pending flows older than an hour are dropped the next time `start`
  runs. A declined redirect drops the flow this tab started last.

## Errors

`start` and `finish` throw `SaltlineError` for failures on the browser side. Branch on `code`:

| `code` | Meaning |
| --- | --- |
| `START_FAILED` | Your start endpoint answered non-2xx or couldn't be reached, or your `send` rejected. `status` and `body` hold its answer. |
| `INVALID_START_RESPONSE` | Its answer had no `http(s)` `authorizationUrl`, or no `connectionKey`/`sessionKey`. |
| `FINISH_FAILED` | Your finish endpoint answered non-2xx or couldn't be reached, or your `send` rejected. |
| `STORAGE_UNAVAILABLE` | `sessionStorage` is blocked (some private modes, sandboxed iframes). |
| `VERIFIER_NOT_FOUND` | This tab didn't start a flow for the key in the URL. |

When `send` rejects, the original error is the `cause`. `status` and `body` come from its own
`status` and `body`, or else from an axios-style `response.status` and `response.data`, or else
`null`, so you can still branch on the HTTP status. A `SaltlineError` your `send` throws passes
through unchanged.

A provider-side failure isn't thrown: `finish` returns `{ ok: false, error, errorMessage, state }`.

Passing neither `url` nor `send`, or both, or no `provider` to `start`, is a programming error:
`start` and `finish` reject with a plain `TypeError` before touching the URL or the stored verifier.

## Lower-level pieces

`createPkce()` makes a pair with Web Crypto, `parseRedirect(url)` reads the return URL, and
`redirectPath(url)` gives the path without Saltline's params, if you'd rather build the flow
yourself.

## License

MIT
