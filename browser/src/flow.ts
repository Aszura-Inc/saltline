import { SaltlineError } from './errors.ts';
import { createPkce } from './pkce.ts';
import { parseRedirect, stripRedirectParams, type FlowKind } from './redirect.ts';
import { saveVerifier, takeVerifier } from './storage.ts';

/** Your backend endpoint, not Saltline (the API key stays server-side). */
export interface EndpointOptions {
  url: string;
  /** e.g. a CSRF token. */
  headers?: HeadersInit;
  /** Default `same-origin`. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export interface StartOptions extends EndpointOptions {
  /** Extra JSON fields, e.g. `{ provider: 'google' }`. */
  body?: Record<string, unknown>;
  /** Default `location.assign`; `false` to stay on the page. */
  navigate?: ((authorizationUrl: string) => void) | false;
}

export interface StartResult {
  kind: FlowKind;
  key: string;
  authorizationUrl: string;
}

/** POSTs a PKCE challenge to your start endpoint, stores the verifier, then navigates. */
export async function start(options: StartOptions): Promise<StartResult> {
  const pkce = await createPkce();
  const body = await post(options, 'START_FAILED', {
    ...options.body,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  });

  const result = readStartResponse(body);
  saveVerifier(result.key, pkce.codeVerifier);

  const navigate = options.navigate ?? ((url: string) => globalThis.location.assign(url));
  if (navigate !== false) navigate(result.authorizationUrl);
  return result;
}

export interface FinishOptions extends EndpointOptions {
  /** Default `location.href`. */
  location?: string | URL;
  /** Strip Saltline's params from the address bar. Default true unless `location` is given. */
  cleanUrl?: boolean;
}

export type FinishResult<T = unknown> =
  /** Claimed; `data` is your endpoint's response. */
  | { ok: true; kind: FlowKind; key: string; data: T }
  /** Declined or provider error. */
  | { ok: false; error: string; errorMessage: string | null };

/** POSTs the redirect key and verifier to your finish endpoint. Null if not a Saltline redirect. */
export async function finish<T = unknown>(options: FinishOptions): Promise<FinishResult<T> | null> {
  const href = options.location ?? globalThis.location.href;
  const redirect = parseRedirect(href);
  if (redirect === null) return null;

  if (options.cleanUrl ?? options.location === undefined) {
    globalThis.history.replaceState(globalThis.history.state, '', stripRedirectParams(href));
  }

  if (!redirect.ok) return redirect;

  // Deleted before the POST, so it can't be replayed.
  const codeVerifier = takeVerifier(redirect.key);
  if (codeVerifier === null) {
    throw new SaltlineError(
      'VERIFIER_NOT_FOUND',
      'This tab has no verifier for the key in the URL. Start the flow again from this tab.',
    );
  }

  const keyField = redirect.kind === 'connection' ? 'connectionKey' : 'sessionKey';
  const data = await post(options, 'FINISH_FAILED', { [keyField]: redirect.key, codeVerifier });
  return { ok: true, kind: redirect.kind, key: redirect.key, data: data as T };
}

async function post(
  options: EndpointOptions,
  code: 'START_FAILED' | 'FINISH_FAILED',
  payload: Record<string, unknown>,
): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await doFetch(options.url, {
      method: 'POST',
      headers,
      credentials: options.credentials ?? 'same-origin',
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new SaltlineError(code, `Could not reach ${options.url}.`, { cause });
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // not JSON, keep text
  }
  if (!response.ok) {
    throw new SaltlineError(code, `${options.url} answered ${response.status}.`, {
      status: response.status,
      body,
    });
  }
  return body;
}

function readStartResponse(body: unknown): StartResult {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { authorizationUrl, connectionKey, sessionKey } = record;

  // http(s) only: a javascript: URL would run in the page.
  let url: URL | null = null;
  try {
    url = typeof authorizationUrl === 'string' ? new URL(authorizationUrl) : null;
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new SaltlineError(
      'INVALID_START_RESPONSE',
      'Your start endpoint must answer with init’s authorizationUrl (http or https).',
      { body },
    );
  }

  if (typeof connectionKey === 'string' && connectionKey !== '') {
    return { kind: 'connection', key: connectionKey, authorizationUrl: url.toString() };
  }
  if (typeof sessionKey === 'string' && sessionKey !== '') {
    return { kind: 'session', key: sessionKey, authorizationUrl: url.toString() };
  }
  throw new SaltlineError(
    'INVALID_START_RESPONSE',
    'Your start endpoint must answer with init’s connectionKey or sessionKey.',
    { body },
  );
}
