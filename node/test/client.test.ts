import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Saltline, SaltlineError, createPkce, parseConnectionRedirect } from '../src/index.ts';

interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

// A fetch that records every request and answers from a queue.
function fakeFetch(...responses: Response[]) {
  const calls: Recorded[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: new Headers(init?.headers),
      body,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error('fakeFetch: no response queued');
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const client = (fetch: typeof globalThis.fetch) =>
  new Saltline({ apiKey: 'sk_test_01ENV', environment: 'staging', fetch });

const pkce = { codeChallenge: 'challenge', codeChallengeMethod: 'S256' } as const;

describe('client', () => {
  it('requires an API key', () => {
    assert.throws(() => new Saltline({ apiKey: '  ' }), /apiKey/);
  });

  it('defaults to production and accepts a base URL override', () => {
    assert.equal(new Saltline({ apiKey: 'k' }).baseUrl, 'https://api.saltline.dev/v1');
    assert.equal(
      new Saltline({ apiKey: 'k', baseUrl: 'http://localhost:8787/v1/' }).baseUrl,
      'http://localhost:8787/v1',
    );
  });

  it('connections.init posts the body with the API key and integration key', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, { connectionKey: 'ck', authorizationUrl: 'https://provider/auth' }),
    );
    const result = await client(fetch).connections.init(
      'google-calendar',
      { auth: 'oAuth2', redirectUrl: 'https://app.test/back', ...pkce },
      { integrationKey: 'primary' },
    );

    assert.deepEqual(result, { connectionKey: 'ck', authorizationUrl: 'https://provider/auth' });
    const [call] = calls;
    assert.equal(call!.method, 'POST');
    assert.equal(call!.url, 'https://api-staging.saltline.dev/v1/connections/google-calendar/init');
    assert.equal(call!.headers.get('authorization'), 'Bearer sk_test_01ENV');
    assert.equal(call!.headers.get('x-saltline-integration-key'), 'primary');
    assert.equal(call!.headers.get('content-type'), 'application/json');
    assert.deepEqual(call!.body, { auth: 'oAuth2', redirectUrl: 'https://app.test/back', ...pkce });
  });

  it('omits headers that were not given', async () => {
    const { fetch, calls } = fakeFetch(json(200, { connectionKey: 'ck', authorizationUrl: 'u' }));
    await client(fetch).connections.init('google', { auth: 'oAuth2', redirectUrl: 'https://x.test', ...pkce });
    assert.equal(calls[0]!.headers.has('x-saltline-integration-key'), false);
  });

  it('keys travel in headers, never the body', async () => {
    const connection = {
      connectionKey: 'ck',
      providerKey: 'google',
      integrationKey: 'primary',
      authType: 'oAuth2',
      status: 'active',
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
    };
    const { fetch, calls } = fakeFetch(
      json(200, { connection }),
      json(200, { revoked: true }),
      json(200, { session: { ...connection, sessionKey: 'sk', connectionKey: undefined } }),
    );
    const saltline = client(fetch);

    assert.deepEqual(await saltline.connections.refresh('google', 'ck'), connection);
    await saltline.connections.revoke('google', 'ck');
    await saltline.sessions.refresh('google', 'sk');

    assert.equal(calls[0]!.url.endsWith('/connections/google/refresh'), true);
    assert.equal(calls[0]!.headers.get('x-saltline-connection-key'), 'ck');
    assert.equal(calls[0]!.body, undefined);
    assert.equal(calls[1]!.method, 'DELETE');
    assert.equal(calls[1]!.headers.get('x-saltline-connection-key'), 'ck');
    assert.equal(calls[2]!.url.endsWith('/auth/google/refresh'), true);
    assert.equal(calls[2]!.headers.get('x-saltline-session-key'), 'sk');
  });

  it('connections.claim sends the key as a header, the verifier in the body, and returns the connection', async () => {
    const connection = {
      connectionKey: 'ck',
      providerKey: 'google',
      integrationKey: 'primary',
      authType: 'oAuth2',
      status: 'active',
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
    };
    const { fetch, calls } = fakeFetch(json(200, { connection }));
    const result = await client(fetch).connections.claim('google', 'ck', 'verifier');

    assert.deepEqual(result, connection);
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, 'https://api-staging.saltline.dev/v1/connections/google/claim');
    assert.equal(calls[0]!.headers.get('x-saltline-connection-key'), 'ck');
    assert.deepEqual(calls[0]!.body, { codeVerifier: 'verifier' });
  });

  it('connections.claim surfaces a verifier mismatch as a SaltlineError', async () => {
    const { fetch } = fakeFetch(
      json(403, { error: "The codeVerifier doesn't match.", code: 'CODE_VERIFIER_MISMATCH' }, {
        'x-saltline-error-code': 'CODE_VERIFIER_MISMATCH',
      }),
    );
    await assert.rejects(
      client(fetch).connections.claim('google', 'ck', 'wrong'),
      (error: unknown) => error instanceof SaltlineError && error.code === 'CODE_VERIFIER_MISMATCH',
    );
  });

  it('sessions.claim sends the session key as a header and the verifier in the body', async () => {
    const { fetch, calls } = fakeFetch(json(200, { user: { email: 'a@b.test' }, raw: {} }));
    const user = await client(fetch).sessions.claim('google', 'sk', 'verifier');
    assert.deepEqual(user.user, { email: 'a@b.test' });
    assert.equal(calls[0]!.headers.get('x-saltline-session-key'), 'sk');
    assert.deepEqual(calls[0]!.body, { codeVerifier: 'verifier' });
  });

  it('encodes path segments so a key cannot change the route', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, {
        webhook: { webhookKey: 'a/b', status: 'active', createdAt: 'x', updatedAt: 'x' },
      }),
    );
    await client(fetch).webhooks.get('trello', 'a/b', { connectionKey: 'ck' });
    assert.equal(calls[0]!.url, 'https://api-staging.saltline.dev/v1/webhooks/trello/a%2Fb');
  });

  it('turns a Saltline error into SaltlineError with its code and request id', async () => {
    const { fetch } = fakeFetch(
      json(
        401,
        { error: 'Your API key has expired.', code: 'API_KEY_EXPIRED' },
        { 'x-saltline-error-code': 'API_KEY_EXPIRED', 'x-saltline-request-id': 'req_1' },
      ),
    );
    await assert.rejects(client(fetch).environment.integrations(), (error: unknown) => {
      assert.ok(error instanceof SaltlineError);
      assert.equal(error.code, 'API_KEY_EXPIRED');
      assert.equal(error.status, 401);
      assert.equal(error.requestId, 'req_1');
      return true;
    });
  });
});

describe('proxy', () => {
  it('relays a provider error instead of throwing', async () => {
    const { fetch, calls } = fakeFetch(json(404, { error: 'board not found' }));
    const response = await client(fetch).proxy.fetch('trello', '/1/boards/abc', {
      connectionKey: 'ck',
      query: { fields: 'name' },
      headers: { Accept: 'application/json' },
      version: '1',
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'board not found' });
    assert.equal(
      calls[0]!.url,
      'https://api-staging.saltline.dev/v1/proxy/trello/1/boards/abc?fields=name',
    );
    assert.equal(calls[0]!.headers.get('accept'), 'application/json');
    assert.equal(calls[0]!.headers.get('x-saltline-version'), '1');
  });

  it("throws on Saltline's own refusal, marked by x-saltline-error-code", async () => {
    const { fetch } = fakeFetch(
      json(404, { error: 'No such connection.', code: 'CONNECTION_NOT_FOUND' }, {
        'x-saltline-error-code': 'CONNECTION_NOT_FOUND',
      }),
    );
    await assert.rejects(
      client(fetch).proxy.fetch('trello', '1/boards/abc', { connectionKey: 'ck' }),
      (error: unknown) => error instanceof SaltlineError && error.code === 'CONNECTION_NOT_FOUND',
    );
  });

  it('drops caller x-saltline-* headers, whatever their case', async () => {
    const { fetch, calls } = fakeFetch(json(200, {}));
    await client(fetch).proxy.fetch('trello', '1/me', {
      connectionKey: 'right',
      headers: {
        'X-Saltline-Connection-Key': 'wrong',
        'X-Saltline-Callback-Url': 'https://evil.test',
        Accept: 'application/json',
      },
    });
    assert.equal(calls[0]!.headers.get('x-saltline-connection-key'), 'right');
    assert.equal(calls[0]!.headers.has('x-saltline-callback-url'), false);
    assert.equal(calls[0]!.headers.get('accept'), 'application/json');
  });

  it('enqueue sends the callback URL and returns the request id', async () => {
    const { fetch, calls } = fakeFetch(json(202, { requestId: 'req_9' }));
    const result = await client(fetch).proxy.enqueue('trello', '1/boards', {
      connectionKey: 'ck',
      method: 'POST',
      body: { name: 'New' },
      callbackUrl: 'https://app.test/callback',
    });
    assert.deepEqual(result, { requestId: 'req_9' });
    assert.equal(calls[0]!.headers.get('x-saltline-callback-url'), 'https://app.test/callback');
    assert.deepEqual(calls[0]!.body, { name: 'New' });
  });

  it('rejects an empty or traversing path before any request', async () => {
    const { fetch, calls } = fakeFetch();
    const saltline = client(fetch);
    await assert.rejects(saltline.proxy.fetch('trello', '/', { connectionKey: 'ck' }), TypeError);
    await assert.rejects(saltline.proxy.fetch('trello', '1/../admin', { connectionKey: 'ck' }), TypeError);
    assert.equal(calls.length, 0);
  });
});

describe('helpers', () => {
  it('createPkce returns an S256 challenge of the verifier', async () => {
    const pkce = await createPkce();
    const expected = createHash('sha256').update(pkce.codeVerifier).digest('base64url');
    assert.equal(pkce.codeChallenge, expected);
    assert.equal(pkce.codeChallengeMethod, 'S256');
    assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  });

  it('parseConnectionRedirect reads success and failure', () => {
    assert.deepEqual(parseConnectionRedirect('https://app.test/back?connectionKey=ck'), {
      ok: true,
      connectionKey: 'ck',
    });
    assert.deepEqual(
      parseConnectionRedirect('https://app.test/back?error=auth_error&error_message=Denied'),
      { ok: false, error: 'auth_error', errorMessage: 'Denied' },
    );
    assert.deepEqual(parseConnectionRedirect('https://app.test/back'), {
      ok: false,
      error: 'missing_connection_key',
      errorMessage: null,
    });
  });
});
