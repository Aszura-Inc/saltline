import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  SaltlineButton,
  useSaltlineFinish,
  useSaltlineStart,
  type UseSaltlineFinish,
  type UseSaltlineStart,
} from '../src/react.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fake browser globals, as in flow.test.ts.

let storage: Map<string, string>;
let href: string;
let assigned: string[];

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  storage = new Map();
  href = 'https://app.test/';
  assigned = [];
  setGlobal('sessionStorage', {
    get length() {
      return storage.size;
    },
    key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  setGlobal('location', {
    get href() {
      return href;
    },
    assign: (url: string) => assigned.push(url),
  });
  setGlobal('history', {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => {
      href = url;
    },
  });
});

function fakeFetch(...responses: Response[]) {
  const calls: Array<Record<string, unknown>> = [];
  const fetch = async (_input: string | URL | Request, init: RequestInit = {}) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (next === undefined) throw new Error('fakeFetch: nothing queued');
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const INIT = { connectionKey: 'ck_1', authorizationUrl: 'https://provider.test/consent' };

async function renderHook<T>(useHook: () => T) {
  const latest: { current: T | undefined } = { current: undefined };
  function Probe(): null {
    latest.current = useHook();
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  // New element each time; React skips an identical one.
  const element = (): ReactElement => createElement(Probe);
  await act(async () => {
    renderer = create(element());
  });
  return {
    latest,
    rerender: async (next: () => T) => {
      useHook = next;
      await act(async () => renderer!.update(element()));
    },
  };
}

describe('useSaltlineStart', () => {
  it('starts the flow and stays pending while the page leaves', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    const { latest } = await renderHook(() => useSaltlineStart({ url: '/start', fetch }));

    await act(async () => {
      await latest.current!.start({ provider: 'google' });
    });

    assert.deepEqual(assigned, [INIT.authorizationUrl]);
    assert.equal(calls[0]!.provider, 'google');
    assert.equal(latest.current!.pending, true);
    assert.equal(latest.current!.error, null);
    assert.ok(storage.has('saltline:pkce:ck_1'));
  });

  it('reports a failure through error and onError, and clears pending', async () => {
    const { fetch } = fakeFetch(json(500, {}));
    const seen: unknown[] = [];
    const { latest } = await renderHook<UseSaltlineStart>(() =>
      useSaltlineStart({ url: '/start', fetch, onError: (e) => seen.push(e) }),
    );

    let result: unknown = 'unset';
    await act(async () => {
      result = await latest.current!.start();
    });

    assert.equal(result, undefined);
    assert.equal(latest.current!.pending, false);
    assert.equal((latest.current!.error as { code: string }).code, 'START_FAILED');
    assert.equal(seen.length, 1);
  });
});

describe('useSaltlineFinish', () => {
  async function startedFlow() {
    const { fetch } = fakeFetch(json(200, INIT));
    const { latest } = await renderHook(() => useSaltlineStart({ url: '/start', fetch }));
    await act(async () => {
      await latest.current!.start();
    });
  }

  // react-test-renderer doesn't replay effects, so the StrictMode guard isn't tested here.
  it('claims the redirect and reports the result', async () => {
    await startedFlow();
    href = 'https://app.test/connected?connectionKey=ck_1';
    const { fetch, calls } = fakeFetch(json(200, { connected: true }));

    const { latest } = await renderHook<UseSaltlineFinish<{ connected: boolean }>>(() =>
      useSaltlineFinish({ url: '/finish', fetch }),
    );

    assert.equal(calls.length, 1);
    assert.equal(latest.current!.loading, false);
    assert.deepEqual(latest.current!.result, {
      ok: true,
      kind: 'connection',
      key: 'ck_1',
      data: { connected: true },
    });
  });

  it('settles to null on an ordinary visit', async () => {
    const { fetch, calls } = fakeFetch();
    const { latest } = await renderHook(() => useSaltlineFinish({ url: '/finish', fetch }));
    assert.equal(calls.length, 0);
    assert.deepEqual(latest.current, { loading: false, result: null, error: null });
  });

  it('surfaces a missing verifier as error', async () => {
    href = 'https://app.test/connected?connectionKey=ck_unknown';
    const { latest } = await renderHook(() =>
      useSaltlineFinish({ url: '/finish', fetch: fakeFetch().fetch }),
    );
    assert.equal((latest.current!.error as { code: string }).code, 'VERIFIER_NOT_FOUND');
  });

  it('waits while enabled is false', async () => {
    await startedFlow();
    href = 'https://app.test/connected?connectionKey=ck_1';
    const { fetch, calls } = fakeFetch(json(200, {}));

    const hook = await renderHook(() =>
      useSaltlineFinish({ url: '/finish', fetch, enabled: false }),
    );
    assert.equal(calls.length, 0);

    await hook.rerender(() => useSaltlineFinish({ url: '/finish', fetch, enabled: true }));
    assert.equal(calls.length, 1);
    assert.equal(hook.latest.current!.result?.ok, true);
  });
});

describe('SaltlineButton', () => {
  const click = (renderer: ReactTestRenderer, defaultPrevented = false) =>
    act(async () => {
      renderer.root.findByType('button').props.onClick({ defaultPrevented });
    });

  it('starts on click with its body, then shows busy', async () => {
    const { fetch, calls } = fakeFetch(json(200, INIT));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SaltlineButton, { url: '/start', fetch, body: { provider: 'google' } }, 'Go'),
      );
    });

    const before = renderer.root.findByType('button').props;
    assert.equal(before.type, 'button');
    assert.equal(before.disabled, false);

    await click(renderer);

    assert.equal(calls[0]!.provider, 'google');
    assert.deepEqual(assigned, [INIT.authorizationUrl]);
    const after = renderer.root.findByType('button').props;
    assert.equal(after.disabled, true);
    assert.equal(after['aria-busy'], true);
  });

  it('calls onError and re-enables on failure', async () => {
    const { fetch } = fakeFetch(json(403, {}));
    const seen: unknown[] = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SaltlineButton, { url: '/start', fetch, onError: (e) => seen.push(e) }),
      );
    });

    await click(renderer);

    assert.equal((seen[0] as { code: string }).code, 'START_FAILED');
    assert.equal(renderer.root.findByType('button').props.disabled, false);
  });

  it('does nothing when your onClick prevents default', async () => {
    const { fetch, calls } = fakeFetch();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SaltlineButton, { url: '/start', fetch, onClick: () => {} }));
    });
    await click(renderer, true);
    assert.equal(calls.length, 0);
  });
});
