import { SaltlineError } from './errors.ts';

const PREFIX = 'saltline:pkce:';
/** The key of the flow this tab started most recently; an error redirect carries no key. */
const LATEST = 'saltline:latest';
// Saltline expires pending flows sooner (10 + 30 min).
const MAX_AGE_MS = 60 * 60 * 1000;

/** What `start` leaves in this tab for `finish`. */
export interface PendingFlow {
  codeVerifier: string;
  provider: string;
  /** Whatever `start` was given as `state`; undefined if nothing. */
  state: unknown;
}

interface Stored extends PendingFlow {
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

/** Stores the pending flow under its key. sessionStorage is per-tab. */
export function savePending(key: string, pending: PendingFlow, now = Date.now()): void {
  const store = storage();
  sweep(store, now);
  try {
    store.setItem(PREFIX + key, JSON.stringify({ ...pending, createdAt: now } satisfies Stored));
    store.setItem(LATEST, key);
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'Could not write to sessionStorage.', { cause });
  }
}

/** Reads and deletes the pending flow (one use). */
export function takePending(key: string): PendingFlow | null {
  const store = storage();
  let raw: string | null;
  try {
    raw = store.getItem(PREFIX + key);
    store.removeItem(PREFIX + key);
    if (store.getItem(LATEST) === key) store.removeItem(LATEST);
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'Could not read sessionStorage.', { cause });
  }
  return parse(raw);
}

/**
 * Reads and deletes the flow this tab started last. For an error redirect, which names no key:
 * the provider sent the user back without finishing, so that flow is over either way.
 */
export function takeLatest(): PendingFlow | null {
  const store = storage();
  let key: string | null;
  try {
    key = store.getItem(LATEST);
  } catch (cause) {
    throw new SaltlineError('STORAGE_UNAVAILABLE', 'Could not read sessionStorage.', { cause });
  }
  return key === null ? null : takePending(key);
}

function parse(raw: string | null): PendingFlow | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.codeVerifier !== 'string' || typeof parsed.provider !== 'string') return null;
    return { codeVerifier: parsed.codeVerifier, provider: parsed.provider, state: parsed.state };
  } catch {
    return null;
  }
}

// Clears flows abandoned more than an hour ago.
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
