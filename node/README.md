# @aszura/saltline-node

The Saltline API client for Node.js 20+ and other server-side JavaScript runtimes (Deno, Bun, edge
workers).

```sh
npm install @aszura/saltline-node
```

It holds your secret API key, so use it on your server only — never in a browser or mobile app.

## Connect a user's account

Connecting uses PKCE: the connection only goes live once you `claim` it with the verifier, so a
`connectionKey` taken from a redirect URL can't be attached to anyone else. Keep the verifier where
only this user's browser reaches it — their session, never a store looked up by `connectionKey`.

```ts
import { Saltline, createPkce, parseConnectionRedirect } from '@aszura/saltline-node';

const saltline = new Saltline({ apiKey: process.env.SALTLINE_API_KEY! });

// Starting:
const pkce = await createPkce();
const { authorizationUrl } = await saltline.connections.init('google', {
  auth: 'oAuth2',
  redirectUrl: 'https://yourapp.com/connected',
  codeChallenge: pkce.codeChallenge,
  codeChallengeMethod: pkce.codeChallengeMethod,
  externalUserId: 'user-123',
});
req.session.saltlineConnect = pkce.codeVerifier;
// redirect the browser to authorizationUrl

// Back at /connected, in the same browser session:
const result = parseConnectionRedirect(requestUrl);
const codeVerifier = req.session.saltlineConnect;
delete req.session.saltlineConnect; // one use only
if (result.ok && codeVerifier) {
  const connection = await saltline.connections.claim('google', result.connectionKey, codeVerifier);
  // store connection.connectionKey against your user — it's active now
}
```

## Serve the browser package

[`@aszura/saltline-browser`](../browser/README.md) makes the PKCE pair in the browser and calls two
endpoints on your server: start and finish. `connectFlow` is that pair, ready to mount. Give it the
providers you allow and the page the user comes back to; it checks the browser's input, calls
`init` and `claim`, and answers what the package expects.

```ts
import { Saltline, connectFlow } from '@aszura/saltline-node';

const saltline = new Saltline({ apiKey: process.env.SALTLINE_API_KEY! });
const connect = connectFlow(saltline, {
  providers: ['google', 'trello'], // or { trello: { integrationKey: '…', auth: 'oAuth1' } }
  redirectUrl: 'https://yourapp.com/connected',
});

// Express (after express.json() and your login middleware):
app.post('/saltline/start', requireLogin, connect.express.start((req) => ({ externalUserId: req.user.id })));
app.post('/saltline/finish', requireLogin, connect.express.finish(async ({ connection }, req) => {
  await db.saveConnection(req.user.id, connection.connectionKey);
  return { connected: true }; // the browser gets this as result.data
}));
```

Next.js App Router, Remix, Hono, SvelteKit and Workers take a `Request` and return a `Response`:

```ts
// app/saltline/start/route.ts
export const POST = connect.web.start(async (request) => ({ externalUserId: (await currentUser(request)).id }));

// app/saltline/finish/route.ts
export const POST = connect.web.finish(async ({ connection }, request) => {
  const user = await currentUser(request); // throw a Response to answer 401 or redirect
  await db.saveConnection(user.id, connection.connectionKey);
  return { connected: true };
});
```

Sign-in is `signInFlow` with the same options; its claim result is `{ provider, sessionKey, user, raw }`.

Underneath, `connect.start(input, { externalUserId })` and `connect.finish(input)` do the work for
any other framework. They throw `FlowInputError` (`status` 400, `code` `UNKNOWN_PROVIDER` or
`INVALID_INPUT`) for bad input and `SaltlineError` for Saltline's answer; `flowErrorReply(error)`
turns either into `{ status, body }` the way the handlers do: 400 for bad input or a claim Saltline
refused (expired, reused, wrong verifier), 502 for any other Saltline error, null for anything else.

## Call the provider's API

```ts
const response = await saltline.proxy.fetch('trello', '1/members/me/boards', { connectionKey });
const boards = await response.json();
```

You get the provider's response exactly as it sent it, error statuses included. Only Saltline's own
refusals throw.

## Errors

```ts
import { SaltlineError } from '@aszura/saltline-node';

try {
  await saltline.connections.refresh('google', connectionKey);
} catch (error) {
  if (error instanceof SaltlineError && error.code === 'CONFLICT') {
    // a refresh is already running — retry shortly
  }
}
```

Branch on `error.code`, never on `error.message`. Quote `error.requestId` when asking for help.

## Verify webhooks

```ts
import { verifyWebhook } from '@aszura/saltline-node';

// Use the raw body, before any JSON parsing.
const valid = await verifyWebhook(request.headers, rawBody, process.env.SALTLINE_SIGNING_SECRET!);
```

## Sign users in

`init` and `claim` need your API key, so your server calls both. The PKCE verifier ties the
`claim` to the browser that clicked "sign in", so it has to wait somewhere only that browser
reaches — never in a store looked up by `sessionKey`, or anyone holding the session key could claim
it. Two ways to do that:

**The browser makes the pair**, best when your backend keeps no session. The browser keeps the
verifier in `sessionStorage`, sends your backend only the challenge for `init`, and sends the
verifier back at the callback for `claim`. [`@aszura/saltline-browser`](../browser/README.md) does the
browser side, connections included, and `signInFlow` [serves it](#serve-the-browser-package).

**Your server makes the pair** — best when you already have server sessions. Keep the verifier in
this user's session, behind their cookie:

```ts
import { createPkce } from '@aszura/saltline-node';

// Starting sign-in:
const pkce = await createPkce();
const { sessionKey, authorizationUrl } = await saltline.sessions.init('google', {
  auth: 'oAuth2',
  redirectUrl: 'https://yourapp.com/signed-in',
  codeChallenge: pkce.codeChallenge,
  codeChallengeMethod: pkce.codeChallengeMethod,
});
req.session.saltline = { sessionKey, codeVerifier: pkce.codeVerifier };
// redirect the browser to authorizationUrl

// Back at /signed-in, in the same browser session:
const pending = req.session.saltline;
delete req.session.saltline; // one use only
const { user } = await saltline.sessions.claim('google', pending.sessionKey, pending.codeVerifier);
```

## License

MIT
