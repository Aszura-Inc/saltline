import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { FlowInputError, Saltline, SaltlineError, connectFlow, signInFlow } from '../src/index.ts';

interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-saltline-request-id': 'req_1' },
  });

const client = (fetch: typeof globalThis.fetch) =>
  new Saltline({ apiKey: 'sk_test', environment: 'staging', fetch });

const INIT = { connectionKey: 'ck_1', authorizationUrl: 'https://provider.test/consent' };
const CONNECTION = { connectionKey: 'ck_1', providerKey: 'google', status: 'active' };
const START_INPUT = { provider: 'google', codeChallenge: 'challenge', codeChallengeMethod: 'S256' };
const FINISH_INPUT = { provider: 'google', connectionKey: 'ck_1', codeVerifier: 'verifier' };

const connect = (fetch: typeof globalThis.fetch) =>
  connectFlow(client(fetch), {
    providers: { google: {}, trello: { integrationKey: 'primary', auth: 'oAuth1' } },
    redirectUrl: 'https://app.test/connected',
  });

describe('connectFlow.start', () => {
  it('inits the provider with the challenge and answers what the browser expects', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));

    const started = await connect(fetch).start(START_INPUT, { externalUserId: 'u1' });

    assert.deepEqual(started, { provider: 'google', ...INIT });
    const [call] = calls;
    assert.equal(call!.url, 'https://api-staging.saltline.dev/v1/connections/google/init');
    assert.deepEqual(call!.body, {
      auth: 'oAuth2',
      redirectUrl: 'https://app.test/connected',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      externalUserId: 'u1',
    });
    assert.equal(call!.headers.has('x-saltline-integration-key'), false);
  });

  it('applies per-provider auth and integration key, and a redirectUrl function', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    const flow = connectFlow(client(fetch), {
      providers: { trello: { integrationKey: 'primary', auth: 'oAuth1' } },
      redirectUrl: (provider) => `https://app.test/connected/${provider}`,
      theme: 'dark',
    });

    await flow.start({ ...START_INPUT, provider: 'trello' });

    const [call] = calls;
    assert.equal(call!.headers.get('x-saltline-integration-key'), 'primary');
    assert.equal((call!.body as { auth: string }).auth, 'oAuth1');
    assert.equal(
      (call!.body as { redirectUrl: string }).redirectUrl,
      'https://app.test/connected/trello',
    );
    assert.equal((call!.body as { theme: string }).theme, 'dark');
    assert.equal((call!.body as { externalUserId: unknown }).externalUserId, null);
  });

  it('lists its providers', () => {
    assert.deepEqual(connect(fakeFetch().fetch).providers, ['google', 'trello']);
    assert.deepEqual(
      connectFlow(client(fakeFetch().fetch), { providers: ['a', 'b'], redirectUrl: 'https://x' })
        .providers,
      ['a', 'b'],
    );
    assert.throws(
      () => connectFlow(client(fakeFetch().fetch), { providers: [], redirectUrl: 'https://x' }),
      /providers/,
    );
  });

  it('refuses a provider outside the allowlist, without calling Saltline', async () => {
    const { fetch, calls } = fakeFetch();
    await assert.rejects(connect(fetch).start({ ...START_INPUT, provider: 'github' }), {
      name: 'FlowInputError',
      code: 'UNKNOWN_PROVIDER',
      status: 400,
    });
    await assert.rejects(connect(fetch).start({ ...START_INPUT, provider: ['google'] }), {
      code: 'UNKNOWN_PROVIDER',
    });
    assert.equal(calls.length, 0);
  });

  it('refuses a bad challenge, method or body', async () => {
    const flow = connect(fakeFetch().fetch);
    await assert.rejects(flow.start({ ...START_INPUT, codeChallenge: '' }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(flow.start({ ...START_INPUT, codeChallengeMethod: 'plain' }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(flow.start('nope'), { code: 'INVALID_INPUT' });
    await assert.rejects(flow.start(null), { code: 'INVALID_INPUT' });
  });
});

describe('connectFlow.finish', () => {
  it('claims with the key as a header and the verifier in the body', async () => {
    const { fetch, calls } = fakeFetch(json(200, { connection: CONNECTION }));

    const claimed = await connect(fetch).finish(FINISH_INPUT);

    assert.deepEqual(claimed, { provider: 'google', connectionKey: 'ck_1', connection: CONNECTION });
    const [call] = calls;
    assert.equal(call!.url, 'https://api-staging.saltline.dev/v1/connections/google/claim');
    assert.equal(call!.headers.get('x-saltline-connection-key'), 'ck_1');
    assert.deepEqual(call!.body, { codeVerifier: 'verifier' });
  });

  it('needs the provider, key and verifier', async () => {
    const flow = connect(fakeFetch().fetch);
    await assert.rejects(flow.finish({ ...FINISH_INPUT, provider: 'github' }), {
      code: 'UNKNOWN_PROVIDER',
    });
    await assert.rejects(flow.finish({ ...FINISH_INPUT, connectionKey: undefined }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(flow.finish({ ...FINISH_INPUT, codeVerifier: 7 }), {
      code: 'INVALID_INPUT',
    });
  });

  it('passes Saltline’s refusal through', async () => {
    const { fetch } = fakeFetch(json(400, { code: 'CODE_VERIFIER_MISMATCH', error: 'Mismatch' }));
    await assert.rejects(connect(fetch).finish(FINISH_INPUT), (error: unknown) => {
      assert.ok(error instanceof SaltlineError);
      assert.equal(error.code, 'CODE_VERIFIER_MISMATCH');
      return true;
    });
  });
});

describe('signInFlow', () => {
  const signIn = (fetch: typeof globalThis.fetch) =>
    signInFlow(client(fetch), { providers: ['google'], redirectUrl: 'https://app.test/signed-in' });

  it('starts a session and answers sessionKey', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, { sessionKey: 'sk_1', authorizationUrl: 'https://provider.test/consent' }),
    );
    const started = await signIn(fetch).start(START_INPUT);
    assert.deepEqual(started, {
      provider: 'google',
      sessionKey: 'sk_1',
      authorizationUrl: 'https://provider.test/consent',
    });
    assert.equal(calls[0]!.url, 'https://api-staging.saltline.dev/v1/auth/google/init');
    assert.equal((calls[0]!.body as { auth: string }).auth, 'oAuth2');
  });

  it('claims the session and returns the user', async () => {
    const { fetch, calls } = fakeFetch(json(200, { user: { email: 'a@b.c' }, raw: { sub: '1' } }));
    const claimed = await signIn(fetch).finish({
      provider: 'google',
      sessionKey: 'sk_1',
      codeVerifier: 'verifier',
    });
    assert.deepEqual(claimed, {
      provider: 'google',
      sessionKey: 'sk_1',
      user: { email: 'a@b.c' },
      raw: { sub: '1' },
    });
    assert.equal(calls[0]!.url, 'https://api-staging.saltline.dev/v1/auth/google/claim');
    assert.equal(calls[0]!.headers.get('x-saltline-session-key'), 'sk_1');
    await assert.rejects(signIn(fakeFetch().fetch).finish(FINISH_INPUT), {
      code: 'INVALID_INPUT',
      message: /sessionKey/,
    });
  });
});

// Express fakes.
function expressCall(body: unknown, extra: Record<string, unknown> = {}) {
  const sent: { status?: number; body?: unknown } = {};
  const errors: unknown[] = [];
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  const req = { body, ...extra };
  const res = {
    status: (status: number) => ({
      json: (json: unknown) => {
        Object.assign(sent, { status, body: json });
        settle();
      },
    }),
  };
  const next = (error?: unknown) => {
    errors.push(error);
    settle();
  };
  return { req, res, next, sent, errors, done };
}

describe('express handlers', () => {
  it('start answers 200 with the browser payload, using init from the request', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    const handler = connect(fetch).express.start<{ body?: unknown; user: { id: string } }>(
      (req) => ({ externalUserId: req.user.id }),
    );
    const call = expressCall(START_INPUT, { user: { id: 'u7' } });

    handler(call.req as { body?: unknown; user: { id: string } }, call.res, call.next);
    await call.done;

    assert.equal(call.sent.status, 200);
    assert.deepEqual(call.sent.body, { provider: 'google', ...INIT });
    assert.equal((calls[0]!.body as { externalUserId: string }).externalUserId, 'u7');
  });

  it('start answers 400 for bad input, with a code', async () => {
    const call = expressCall({ ...START_INPUT, provider: 'github' });
    connect(fakeFetch().fetch).express.start()(call.req, call.res, call.next);
    await call.done;
    assert.equal(call.sent.status, 400);
    assert.deepEqual(call.sent.body, {
      code: 'UNKNOWN_PROVIDER',
      error: 'provider is not one this flow allows.',
    });
  });

  it('start hints when the body was never parsed', async () => {
    const call = expressCall(undefined);
    connect(fakeFetch().fetch).express.start()(call.req, call.res, call.next);
    await call.done;
    assert.equal(call.sent.status, 400);
    assert.equal((call.sent.body as { code: string }).code, 'INVALID_INPUT');
  });

  it('finish answers what your callback returns, after claiming', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const saved: unknown[] = [];
    const handler = connect(fetch).express.finish(async (claimed, req) => {
      saved.push([req.user, claimed.connection.connectionKey]);
      return { connected: true };
    });
    const call = expressCall(FINISH_INPUT, { user: 'u7' });

    handler(call.req, call.res, call.next);
    await call.done;

    assert.deepEqual(saved, [['u7', 'ck_1']]);
    assert.deepEqual(call.sent, { status: 200, body: { connected: true } });
  });

  it('finish answers { ok: true } when the callback returns nothing', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const call = expressCall(FINISH_INPUT);
    connect(fetch).express.finish(() => {})(call.req, call.res, call.next);
    await call.done;
    assert.deepEqual(call.sent, { status: 200, body: { ok: true } });
  });

  it('finish answers 400 with Saltline’s code when the claim is refused', async () => {
    const { fetch } = fakeFetch(json(404, { code: 'CONNECTION_NOT_FOUND', error: 'Gone' }));
    const call = expressCall(FINISH_INPUT);
    connect(fetch).express.finish(() => ({ connected: true }))(call.req, call.res, call.next);
    await call.done;
    assert.deepEqual(call.sent, {
      status: 400,
      body: { code: 'CONNECTION_NOT_FOUND', error: 'Gone', requestId: 'req_1' },
    });
  });

  it('answers 502 for any other Saltline error', async () => {
    const { fetch } = fakeFetch(json(401, { code: 'INVALID_API_KEY', error: 'Bad key' }));
    const call = expressCall(START_INPUT);
    connect(fetch).express.start()(call.req, call.res, call.next);
    await call.done;
    assert.equal(call.sent.status, 502);
    assert.equal((call.sent.body as { code: string }).code, 'INVALID_API_KEY');
  });

  it('passes anything else to next', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const boom = new Error('db down');
    const call = expressCall(FINISH_INPUT);
    connect(fetch).express.finish(() => {
      throw boom;
    })(call.req, call.res, call.next);
    await call.done;
    assert.deepEqual(call.errors, [boom]);
    assert.equal(call.sent.status, undefined);
  });
});

describe('web handlers', () => {
  const post = (body: unknown) =>
    new Request('https://app.test/saltline/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('start reads the JSON request and answers a JSON response', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    const handler = connect(fetch).web.start(async (request) => ({
      externalUserId: request.headers.get('x-user'),
    }));

    const response = await handler(
      new Request('https://app.test/s', {
        method: 'POST',
        headers: { 'x-user': 'u9' },
        body: JSON.stringify(START_INPUT),
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { provider: 'google', ...INIT });
    assert.equal((calls[0]!.body as { externalUserId: string }).externalUserId, 'u9');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await connect(fakeFetch().fetch).web.start()(post('not json'));
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, 'INVALID_INPUT');
  });

  it('finish claims and answers your JSON', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const handler = connect(fetch).web.finish((claimed) => ({ key: claimed.connectionKey }));
    const response = await handler(post(FINISH_INPUT));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { key: 'ck_1' });
  });

  it('returns a Response your callback throws', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const handler = connect(fetch).web.finish(() => {
      throw new Response('sign in first', { status: 401 });
    });
    const response = await handler(post(FINISH_INPUT));
    assert.equal(response.status, 401);
  });

  it('rethrows anything else', async () => {
    const { fetch } = fakeFetch(json(200, { connection: CONNECTION }));
    const handler = connect(fetch).web.finish(() => {
      throw new Error('db down');
    });
    await assert.rejects(handler(post(FINISH_INPUT)), /db down/);
  });

  it('FlowInputError is a plain Error with a 400 status', () => {
    const error = new FlowInputError('INVALID_INPUT', 'x');
    assert.ok(error instanceof Error);
    assert.equal(error.status, 400);
  });
});
