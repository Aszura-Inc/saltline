import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import {
  SaltlineError,
  createPkce,
  finish,
  parseRedirect,
  redirectPath,
  start,
} from '../src/index.ts';
import { pkceChallenge } from '../src/pkce.ts';

// Fake browser globals.

class MemoryStorage {
  #items = new Map<string, string>();
  get length(): number {
    return this.#items.size;
  }
  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(name: string): string | null {
    return this.#items.get(name) ?? null;
  }
  setItem(name: string, value: string): void {
    this.#items.set(name, String(value));
  }
  removeItem(name: string): void {
    this.#items.delete(name);
  }
  clear(): void {
    this.#items.clear();
  }
}

let storage: MemoryStorage;
let href: string;
const assigned: string[] = [];

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  storage = new MemoryStorage();
  href = 'https://app.test/';
  assigned.length = 0;
  setGlobal('sessionStorage', storage);
  setGlobal('location', {
    get href() {
      return href;
    },
    assign: (url: string) => assigned.push(url),
  });
  setGlobal('history', {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => {
      href = url;
    },
  });
});

interface Recorded {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Recorded[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (next === undefined) throw new Error('fakeFetch: nothing queued');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const INIT = {
  connectionKey: 'ck_123',
  authorizationUrl: 'https://accounts.provider.test/consent?x=1',
};

const stored = (key: string) =>
  JSON.parse(storage.getItem(`saltline:pkce:${key}`)!) as {
    codeVerifier: string;
    provider: string;
    state: unknown;
  };

describe('createPkce', () => {
  it('computes the S256 challenge of a known verifier', async () => {
    const verifier = 'fixed-verifier-for-the-test-0123456789abcdef';
    assert.equal(
      await pkceChallenge(verifier),
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });

  it('makes a 43-char base64url verifier whose challenge is its SHA-256', async () => {
    const pkce = await createPkce();
    assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(pkce.codeChallengeMethod, 'S256');
    assert.equal(
      pkce.codeChallenge,
      createHash('sha256').update(pkce.codeVerifier).digest('base64url'),
    );
  });
});

describe('parseRedirect', () => {
  it('reads connections, sessions and errors, and ignores other pages', () => {
    assert.deepEqual(parseRedirect('https://app.test/back?connectionKey=ck'), {
      ok: true,
      kind: 'connection',
      key: 'ck',
    });
    assert.deepEqual(parseRedirect('https://app.test/back?sessionKey=sk'), {
      ok: true,
      kind: 'session',
      key: 'sk',
    });
    assert.deepEqual(
      parseRedirect('https://app.test/back?error=auth_error&error_message=Declined'),
      { ok: false, error: 'auth_error', errorMessage: 'Declined' },
    );
    assert.equal(parseRedirect('https://app.test/back?page=2'), null);
  });

  it('redirectPath keeps the rest of the URL, as a path', () => {
    assert.equal(
      redirectPath('https://app.test/back?tab=apps&connectionKey=ck&error_message=x#top'),
      '/back?tab=apps#top',
    );
    assert.equal(redirectPath('https://app.test/back?sessionKey=sk'), '/back');
  });
});

describe('start', () => {
  it('sends the provider and challenge, keeps the verifier in this tab, then navigates', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));

    const result = await start({
      url: '/saltline/start',
      provider: 'google',
      state: { tab: 'apps' },
      body: { integrationKey: 'abc' },
      fetch,
    });

    assert.deepEqual(result, {
      kind: 'connection',
      provider: 'google',
      key: 'ck_123',
      authorizationUrl: INIT.authorizationUrl,
    });
    assert.deepEqual(assigned, [INIT.authorizationUrl]);

    const sent = calls[0]!;
    assert.equal(sent.init.method, 'POST');
    assert.equal(sent.init.credentials, 'same-origin');
    assert.equal(sent.body.provider, 'google');
    assert.equal(sent.body.integrationKey, 'abc');
    assert.equal(sent.body.codeChallengeMethod, 'S256');
    assert.equal('codeVerifier' in sent.body, false);
    assert.equal('state' in sent.body, false);

    const pending = stored('ck_123');
    assert.equal(await pkceChallenge(pending.codeVerifier), sent.body.codeChallenge);
    assert.equal(pending.provider, 'google');
    assert.deepEqual(pending.state, { tab: 'apps' });
    assert.equal(storage.getItem('saltline:latest'), 'ck_123');
  });

  it('the provider option wins over a body field of the same name', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    await start({ url: '/s', provider: 'google', body: { provider: 'forged' }, fetch });
    assert.equal(calls[0]!.body.provider, 'google');
  });

  it('needs a provider, before any side effect', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    // @ts-expect-error provider is required
    await assert.rejects(start({ url: '/s', fetch }), TypeError);
    await assert.rejects(start({ url: '/s', provider: '', fetch }), TypeError);
    assert.equal(calls.length, 0);
    assert.equal(storage.length, 0);
  });

  it('can stay on the page', async () => {
    const { fetch } = fakeFetch(json(200, INIT));
    await start({ url: '/s', provider: 'google', fetch, navigate: false });
    assert.deepEqual(assigned, []);
  });

  it('refuses a non-http authorizationUrl', async () => {
    const { fetch } = fakeFetch(
      json(200, { connectionKey: 'ck', authorizationUrl: 'javascript:alert(1)' }),
    );
    await assert.rejects(start({ url: '/s', provider: 'google', fetch }), {
      code: 'INVALID_START_RESPONSE',
    });
    assert.deepEqual(assigned, []);
    assert.equal(storage.length, 0);
  });

  it('refuses an answer without a key', async () => {
    const { fetch } = fakeFetch(json(200, { authorizationUrl: INIT.authorizationUrl }));
    await assert.rejects(start({ url: '/s', provider: 'google', fetch }), {
      code: 'INVALID_START_RESPONSE',
    });
  });

  it('surfaces your endpoint’s failure with its status and body', async () => {
    const { fetch } = fakeFetch(json(403, { error: 'nope' }));
    await assert.rejects(start({ url: '/s', provider: 'google', fetch }), (error: unknown) => {
      assert.ok(error instanceof SaltlineError);
      assert.equal(error.code, 'START_FAILED');
      assert.equal(error.status, 403);
      assert.deepEqual(error.body, { error: 'nope' });
      return true;
    });
  });

  it('fails clearly when sessionStorage is blocked', async () => {
    setGlobal('sessionStorage', undefined);
    const { fetch } = fakeFetch(json(200, INIT));
    await assert.rejects(start({ url: '/s', provider: 'google', fetch }), {
      code: 'STORAGE_UNAVAILABLE',
    });
    assert.deepEqual(assigned, []);
  });

  it('sweeps verifiers from abandoned flows', async () => {
    storage.setItem('saltline:pkce:old', JSON.stringify({ codeVerifier: 'v', createdAt: 0 }));
    storage.setItem('unrelated', 'kept');
    const { fetch } = fakeFetch(json(200, INIT));
    await start({ url: '/s', provider: 'google', fetch });
    assert.equal(storage.getItem('saltline:pkce:old'), null);
    assert.equal(storage.getItem('unrelated'), 'kept');
  });
});

async function started(init: Record<string, string> = INIT, state?: unknown) {
  const { fetch } = fakeFetch(json(200, init));
  await start({ url: '/start', provider: 'google', state, fetch });
  return stored(init.connectionKey ?? init.sessionKey!).codeVerifier;
}

describe('finish', () => {
  it('claims a connection: provider, key and verifier to your endpoint, once', async () => {
    const verifier = await started(INIT, { tab: 'apps' });
    href = 'https://app.test/connected?connectionKey=ck_123&tab=apps';
    const { fetch, calls } = fakeFetch(json(200, { connection: { connectionKey: 'ck_123' } }));

    const result = await finish({ url: '/finish', fetch });

    assert.deepEqual(result, {
      ok: true,
      kind: 'connection',
      provider: 'google',
      key: 'ck_123',
      data: { connection: { connectionKey: 'ck_123' } },
      state: { tab: 'apps' },
    });
    assert.deepEqual(calls[0]!.body, {
      provider: 'google',
      connectionKey: 'ck_123',
      codeVerifier: verifier,
    });
    assert.equal(href, 'https://app.test/connected?tab=apps');
    assert.equal(storage.getItem('saltline:pkce:ck_123'), null);
    assert.equal(storage.getItem('saltline:latest'), null);
  });

  it('claims a sign-in with sessionKey', async () => {
    const verifier = await started({
      sessionKey: 'sk_9',
      authorizationUrl: INIT.authorizationUrl,
    });
    href = 'https://app.test/signed-in?sessionKey=sk_9';
    const { fetch, calls } = fakeFetch(json(200, { user: {} }));

    const result = await finish({ url: '/finish', fetch });
    assert.deepEqual(calls[0]!.body, {
      provider: 'google',
      sessionKey: 'sk_9',
      codeVerifier: verifier,
    });
    assert.equal(result?.ok && result.state, undefined);
  });

  it('a reload after finishing can’t replay it', async () => {
    await started();
    href = 'https://app.test/connected?connectionKey=ck_123';
    await finish({ url: '/finish', fetch: fakeFetch(json(200, {})).fetch });
    assert.equal(await finish({ url: '/finish', fetch: fakeFetch().fetch }), null);
  });

  it('refuses a key this tab didn’t start, without calling your endpoint', async () => {
    href = 'https://app.test/connected?connectionKey=ck_someone_else';
    const { fetch, calls } = fakeFetch();
    await assert.rejects(finish({ url: '/finish', fetch }), { code: 'VERIFIER_NOT_FOUND' });
    assert.equal(calls.length, 0);
  });

  it('returns a provider error with the last flow’s state, without calling your endpoint', async () => {
    await started(INIT, 'settings');
    href = 'https://app.test/connected?error=auth_error&error_message=Declined';
    const { fetch, calls } = fakeFetch();
    assert.deepEqual(await finish({ url: '/finish', fetch }), {
      ok: false,
      error: 'auth_error',
      errorMessage: 'Declined',
      state: 'settings',
    });
    assert.equal(calls.length, 0);
    assert.equal(href, 'https://app.test/connected');
    // That flow is over: the provider sent the user back without finishing it.
    assert.equal(storage.getItem('saltline:pkce:ck_123'), null);
  });

  it('a provider error with no flow in this tab has undefined state', async () => {
    href = 'https://app.test/connected?error=auth_error';
    const result = await finish({ url: '/finish', fetch: fakeFetch().fetch });
    assert.equal(result?.ok, false);
    assert.equal(result?.state, undefined);
  });

  it('is a no-op on a page Saltline didn’t redirect to', async () => {
    href = 'https://app.test/dashboard';
    assert.equal(await finish({ url: '/finish', fetch: fakeFetch().fetch }), null);
  });

  it('leaves the address bar alone when given an explicit location', async () => {
    await started();
    const { fetch } = fakeFetch(json(200, {}));
    await finish({ url: '/finish', fetch, location: 'https://app.test/x?connectionKey=ck_123' });
    assert.equal(href, 'https://app.test/');
  });

  it('hands the clean path to a router instead of touching history', async () => {
    await started();
    href = 'https://app.test/connected?connectionKey=ck_123&tab=apps#top';
    const { fetch } = fakeFetch(json(200, {}));
    const replaced: string[] = [];

    await finish({ url: '/finish', fetch, cleanUrl: (path) => replaced.push(path) });

    assert.deepEqual(replaced, ['/connected?tab=apps#top']);
    assert.equal(href, 'https://app.test/connected?connectionKey=ck_123&tab=apps#top');
  });

  it('sends extra body fields, which can’t override the provider, key or verifier', async () => {
    const verifier = await started();
    href = 'https://app.test/connected?connectionKey=ck_123';
    const { fetch, calls } = fakeFetch(json(200, {}));

    await finish({
      url: '/finish',
      fetch,
      body: { via: 'settings', provider: 'forged', connectionKey: 'forged', codeVerifier: 'forged' },
    });

    assert.deepEqual(calls[0]!.body, {
      via: 'settings',
      provider: 'google',
      connectionKey: 'ck_123',
      codeVerifier: verifier,
    });
  });
});

describe('send', () => {
  function fakeSend(...answers: Array<unknown>) {
    const payloads: Array<Record<string, unknown>> = [];
    const send = async (payload: Record<string, unknown>) => {
      payloads.push(payload);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    };
    return { send, payloads };
  }

  // What an axios client throws for a non-2xx answer.
  const axiosError = (status: number, data: unknown) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data },
    });

  it('starts through your client: same payload, same storage and navigation', async () => {
    const { send, payloads } = fakeSend(INIT);

    const result = await start({ send, provider: 'google' });

    assert.equal(result.key, 'ck_123');
    assert.deepEqual(assigned, [INIT.authorizationUrl]);
    assert.equal(payloads[0]!.provider, 'google');
    assert.equal(payloads[0]!.codeChallengeMethod, 'S256');
    assert.equal(await pkceChallenge(stored('ck_123').codeVerifier), payloads[0]!.codeChallenge);
  });

  it('can’t get a non-http authorizationUrl past the guard', async () => {
    const { send } = fakeSend({ connectionKey: 'ck', authorizationUrl: 'javascript:alert(1)' });
    await assert.rejects(start({ send, provider: 'google' }), { code: 'INVALID_START_RESPONSE' });
    assert.deepEqual(assigned, []);
    assert.equal(storage.length, 0);
  });

  it('finishes through your client with extra body fields', async () => {
    const verifier = await started({ sessionKey: 'sk_9', authorizationUrl: INIT.authorizationUrl });
    href = 'https://app.test/signed-in?sessionKey=sk_9';
    const { send, payloads } = fakeSend({ user: { id: 1 } });

    const result = await finish({ send, body: { via: 'menu', sessionKey: 'forged' } });

    assert.deepEqual(result, {
      ok: true,
      kind: 'session',
      provider: 'google',
      key: 'sk_9',
      data: { user: { id: 1 } },
      state: undefined,
    });
    assert.deepEqual(payloads[0], {
      via: 'menu',
      provider: 'google',
      sessionKey: 'sk_9',
      codeVerifier: verifier,
    });
    assert.equal(href, 'https://app.test/signed-in');
    assert.equal(storage.getItem('saltline:pkce:sk_9'), null);
  });

  it('wraps an axios-style failure, keeping its status and body', async () => {
    const thrown = axiosError(409, { error: 'already_connected' });
    const { send } = fakeSend(thrown);
    await assert.rejects(start({ send, provider: 'google' }), (error: unknown) => {
      assert.ok(error instanceof SaltlineError);
      assert.equal(error.code, 'START_FAILED');
      assert.equal(error.status, 409);
      assert.deepEqual(error.body, { error: 'already_connected' });
      assert.equal(error.cause, thrown);
      return true;
    });
  });

  it('prefers status and body on the error itself', async () => {
    await started();
    href = 'https://app.test/connected?connectionKey=ck_123';
    const thrown = Object.assign(new Error('nope'), {
      status: 401,
      body: { error: 'expired' },
      response: { status: 500, data: 'ignored' },
    });
    await assert.rejects(finish({ send: fakeSend(thrown).send }), {
      code: 'FINISH_FAILED',
      status: 401,
      body: { error: 'expired' },
    });
  });

  it('uses null status and body when the failure carries neither', async () => {
    await assert.rejects(start({ send: fakeSend(new TypeError('offline')).send, provider: 'g' }), {
      code: 'START_FAILED',
      status: null,
      body: null,
    });
  });

  it('passes on a SaltlineError your send threw, unwrapped', async () => {
    const own = new SaltlineError('STORAGE_UNAVAILABLE', 'from send');
    await assert.rejects(
      start({ send: fakeSend(own).send, provider: 'google' }),
      (error: unknown) => error === own,
    );
  });

  it('needs url or send, and refuses both, before touching the URL or verifier', async () => {
    await started();
    href = 'https://app.test/connected?connectionKey=ck_123';
    const { send } = fakeSend();

    // @ts-expect-error neither url nor send
    await assert.rejects(start({ provider: 'google' }), TypeError);
    // @ts-expect-error neither url nor send
    await assert.rejects(finish({}), TypeError);
    // @ts-expect-error url and send together
    await assert.rejects(finish({ url: '/finish', send }), TypeError);
    // @ts-expect-error fetch-only fields don't go with send
    void (() => start({ send, provider: 'google', headers: {} }));

    assert.equal(href, 'https://app.test/connected?connectionKey=ck_123');
    assert.ok(storage.getItem('saltline:pkce:ck_123'));
  });
});
