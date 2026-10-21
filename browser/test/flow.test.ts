import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import { SaltlineError, createPkce, finish, parseRedirect, start } from '../src/index.ts';
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
});

describe('start', () => {
  it('sends only the challenge, keeps the verifier in this tab, then navigates', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));

    const result = await start({ url: '/saltline/start', body: { provider: 'google' }, fetch });

    assert.deepEqual(result, {
      kind: 'connection',
      key: 'ck_123',
      ...{ authorizationUrl: INIT.authorizationUrl },
    });
    assert.deepEqual(assigned, [INIT.authorizationUrl]);

    const sent = calls[0]!;
    assert.equal(sent.init.method, 'POST');
    assert.equal(sent.init.credentials, 'same-origin');
    assert.equal(sent.body.provider, 'google');
    assert.equal(sent.body.codeChallengeMethod, 'S256');
    assert.equal('codeVerifier' in sent.body, false);

    const stored = JSON.parse(storage.getItem('saltline:pkce:ck_123')!) as { codeVerifier: string };
    assert.equal(await pkceChallenge(stored.codeVerifier), sent.body.codeChallenge);
  });

  it('can stay on the page', async () => {
    const { fetch } = fakeFetch(json(200, INIT));
    await start({ url: '/s', fetch, navigate: false });
    assert.deepEqual(assigned, []);
  });

  it('refuses a non-http authorizationUrl', async () => {
    const { fetch } = fakeFetch(
      json(200, { connectionKey: 'ck', authorizationUrl: 'javascript:alert(1)' }),
    );
    await assert.rejects(start({ url: '/s', fetch }), { code: 'INVALID_START_RESPONSE' });
    assert.deepEqual(assigned, []);
    assert.equal(storage.length, 0);
  });

  it('refuses an answer without a key', async () => {
    const { fetch } = fakeFetch(json(200, { authorizationUrl: INIT.authorizationUrl }));
    await assert.rejects(start({ url: '/s', fetch }), { code: 'INVALID_START_RESPONSE' });
  });

  it('surfaces your endpoint’s failure with its status and body', async () => {
    const { fetch } = fakeFetch(json(403, { error: 'nope' }));
    await assert.rejects(start({ url: '/s', fetch }), (error: unknown) => {
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
    await assert.rejects(start({ url: '/s', fetch }), { code: 'STORAGE_UNAVAILABLE' });
    assert.deepEqual(assigned, []);
  });

  it('sweeps verifiers from abandoned flows', async () => {
    storage.setItem('saltline:pkce:old', JSON.stringify({ codeVerifier: 'v', createdAt: 0 }));
    storage.setItem('unrelated', 'kept');
    const { fetch } = fakeFetch(json(200, INIT));
    await start({ url: '/s', fetch });
    assert.equal(storage.getItem('saltline:pkce:old'), null);
    assert.equal(storage.getItem('unrelated'), 'kept');
  });
});

describe('finish', () => {
  async function started(init: Record<string, string> = INIT) {
    const { fetch } = fakeFetch(json(200, init));
    await start({ url: '/start', fetch });
    return JSON.parse(storage.getItem(`saltline:pkce:${init.connectionKey ?? init.sessionKey}`)!)
      .codeVerifier as string;
  }

  it('claims a connection: key and verifier to your endpoint, once', async () => {
    const verifier = await started();
    href = 'https://app.test/connected?connectionKey=ck_123&tab=apps';
    const { fetch, calls } = fakeFetch(json(200, { connection: { connectionKey: 'ck_123' } }));

    const result = await finish({ url: '/finish', fetch });

    assert.deepEqual(result, {
      ok: true,
      kind: 'connection',
      key: 'ck_123',
      data: { connection: { connectionKey: 'ck_123' } },
    });
    assert.deepEqual(calls[0]!.body, { connectionKey: 'ck_123', codeVerifier: verifier });
    assert.equal(href, 'https://app.test/connected?tab=apps');
    assert.equal(storage.getItem('saltline:pkce:ck_123'), null);
  });

  it('claims a sign-in with sessionKey', async () => {
    const verifier = await started({
      sessionKey: 'sk_9',
      authorizationUrl: INIT.authorizationUrl,
    });
    href = 'https://app.test/signed-in?sessionKey=sk_9';
    const { fetch, calls } = fakeFetch(json(200, { user: {} }));

    await finish({ url: '/finish', fetch });
    assert.deepEqual(calls[0]!.body, { sessionKey: 'sk_9', codeVerifier: verifier });
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

  it('returns a provider error without calling your endpoint', async () => {
    href = 'https://app.test/connected?error=auth_error&error_message=Declined';
    const { fetch, calls } = fakeFetch();
    assert.deepEqual(await finish({ url: '/finish', fetch }), {
      ok: false,
      error: 'auth_error',
      errorMessage: 'Declined',
    });
    assert.equal(calls.length, 0);
    assert.equal(href, 'https://app.test/connected');
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
});
