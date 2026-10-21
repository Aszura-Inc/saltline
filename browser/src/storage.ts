import { SaltlineError } from './errors.ts';

const PREFIX = 'saltline:pkce:';
// Saltline expires pending flows sooner (10 + 30 min).
const MAX_AGE_MS = 60 * 60 * 1000;

interface Stored {
  codeVerifier: string;
  createdAt: number;
}

function storage(): Storage {
  try {
    const store = globalThis.sessionStorage;
    if (store === undefined || store === null) throw new Error('sessionStorage is undefined');
    return store;
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'sessionStorage is not available here.', {
      cause,
    });
  }
}

/** Stores the verifier under the flow key. sessionStorage is per-tab. */
export function saveVerifier(key: string, codeVerifier: string, now = Date.now()): void {
  const store = storage();
  sweep(store, now);
  try {
    store.setItem(PREFIX + key, JSON.stringify({ codeVerifier, createdAt: now } satisfies Stored));
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'Could not write to sessionStorage.', { cause });
  }
}

/** Reads and deletes the verifier (one use). */
export function takeVerifier(key: string): string | null {
  const store = storage();
  let raw: string | null;
  try {
    raw = store.getItem(PREFIX + key);
    store.removeItem(PREFIX + key);
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'Could not read sessionStorage.', { cause });
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return typeof parsed.codeVerifier === 'string' ? parsed.codeVerifier : null;
  } catch {
    return null;
  }
}

// Clears verifiers from abandoned flows.
function sweep(store: Storage, now: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (name === null || !name.startsWith(PREFIX)) continue;
      let createdAt = 0;
      try {
        createdAt = Number((JSON.parse(store.getItem(name) ?? '{}') as Partial<Stored>).createdAt);
      } catch {
        // unreadable = stale
      }
      if (!(now - createdAt < MAX_AGE_MS)) stale.push(name);
    }
    for (const name of stale) store.removeItem(name);
  } catch {
    // best effort
  }
}
