import { SaltlineError } from './errors.ts';
import { createPkce } from './pkce.ts';
import { parseRedirect, redirectPath, stripRedirectParams, type FlowKind } from './redirect.ts';
import { savePending, takeLatest, takePending } from './storage.ts';

/** Your backend endpoint, not Saltline (the API key stays server-side), POSTed as JSON. */
export interface FetchEndpointOptions {
  url: string;
  /** e.g. a CSRF token. */
  headers?: HeadersInit;
  /** Default `same-origin`. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  send?: never;
}

/** Your backend endpoint, reached through your own HTTP client. */
export interface SendEndpointOptions {
  /** Delivers the payload and resolves the endpoint's JSON; a rejection becomes a `SaltlineError`. */
  send: (payload: Record<string, unknown>) => Promise<unknown>;
  url?: never;
  headers?: never;
  credentials?: never;
  fetch?: never;
}

export type EndpointOptions = FetchEndpointOptions | SendEndpointOptions;

export type StartOptions = EndpointOptions & {
  /** Provider key, e.g. `google`. Sent to start, kept in this tab, and sent to finish. */
  provider: string;
  /** Your own context, kept in this tab and handed back by `finish` as `state`. JSON only. */
  state?: unknown;
  /** Extra JSON fields for your start endpoint. */
  body?: Record<string, unknown>;
  /** Default `location.assign`; `false` to stay on the page. */
  navigate?: ((authorizationUrl: string) => void) | false;
};

export interface StartResult {
  kind: FlowKind;
  provider: string;
  key: string;
  authorizationUrl: string;
}

/** POSTs a PKCE challenge to your start endpoint, stores the verifier, then navigates. */
export async function start(options: StartOptions): Promise<StartResult> {
  checkEndpoint(options);
  if (typeof options.provider !== 'string' || options.provider === '') {
    throw new TypeError('Saltline: `provider` is required.');
  }
  const pkce = await createPkce();
  const body = await request(options, 'START_FAILED', {
    ...options.body,
    provider: options.provider,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  });

  const result = readStartResponse(body, options.provider);
  savePending(result.key, {
    codeVerifier: pkce.codeVerifier,
    provider: options.provider,
    state: options.state,
  });

  const navigate = options.navigate ?? ((url: string) => globalThis.location.assign(url));
  if (navigate !== false) navigate(result.authorizationUrl);
  return result;
}

export type FinishOptions = EndpointOptions & {
  /** Extra fields beside the provider, key and verifier. */
  body?: Record<string, unknown>;
  /** Default `location.href`. */
  location?: string | URL;
  /**
   * Strip Saltline's params from the address bar. Default true unless `location` is given.
   * A function gets the clean path (with search and hash) and replaces the URL itself, for a
   * router that must know: `(path) => navigate(path, { replace: true })`.
   */
  cleanUrl?: boolean | ((path: string) => void);
};

export type FinishResult<T = unknown, S = unknown> =
  /** Claimed; `data` is your endpoint's response. */
  | { ok: true; kind: FlowKind; provider: string; key: string; data: T; state: S }
  /** Declined or provider error. `state` is from the flow this tab started last, if any. */
  | { ok: false; error: string; errorMessage: string | null; state: S | undefined };

/**
 * POSTs the provider, redirect key and verifier to your finish endpoint. Null if not a Saltline
 * redirect.
 */
export async function finish<T = unknown, S = unknown>(
  options: FinishOptions,
): Promise<FinishResult<T, S> | null> {
  checkEndpoint(options);
  const href = options.location ?? globalThis.location.href;
  const redirect = parseRedirect(href);
  if (redirect === null) return null;

  const cleanUrl = options.cleanUrl ?? options.location === undefined;
  if (typeof cleanUrl === 'function') {
    cleanUrl(redirectPath(href));
  } else if (cleanUrl) {
    globalThis.history.replaceState(globalThis.history.state, '', stripRedirectParams(href));
  }

  if (!redirect.ok) return { ...redirect, state: takeLatest()?.state as S | undefined };

  // Deleted before the POST, so it can't be replayed.
  const pending = takePending(redirect.key);
  if (pending === null) {
    throw new SaltlineError(
      'VERIFIER_NOT_FOUND',
      'This tab has no verifier for the key in the URL. Start the flow again from this tab.',
    );
  }

  const keyField = redirect.kind === 'connection' ? 'connectionKey' : 'sessionKey';
  const data = await request(options, 'FINISH_FAILED', {
    ...options.body,
    provider: pending.provider,
    [keyField]: redirect.key,
    codeVerifier: pending.codeVerifier,
  });
  return {
    ok: true,
    kind: redirect.kind,
    provider: pending.provider,
    key: redirect.key,
    data: data as T,
    state: pending.state as S,
  };
}

// Before any side effect, so a misconfigured call doesn't strip the URL or spend the verifier.
function checkEndpoint(options: EndpointOptions): void {
  if (options.send !== undefined && options.url !== undefined) {
    throw new TypeError('Saltline: pass either `url` or `send`, not both.');
  }
  if (options.send === undefined && typeof options.url !== 'string') {
    throw new TypeError('Saltline: pass `url` or `send`.');
  }
}

async function request(
  options: EndpointOptions,
  code: 'START_FAILED' | 'FINISH_FAILED',
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (options.send === undefined) return post(options, code, payload);
  try {
    return await options.send(payload);
  } catch (cause) {
    if (cause instanceof SaltlineError) throw cause;
    const { status, body } = failureOf(cause);
    const message = status === null ? 'send failed.' : `send failed with status ${status}.`;
    throw new SaltlineError(code, message, { status, body, cause });
  }
}

// `status`/`body` on the error itself, else an axios-style `response.status`/`response.data`.
function failureOf(error: unknown): { status: number | null; body: unknown } {
  const record = isRecord(error) ? error : {};
  const response = isRecord(record.response) ? record.response : {};
  const status =
    typeof record.status === 'number'
      ? record.status
      : typeof response.status === 'number'
        ? response.status
        : null;
  const body = record.body !== undefined ? record.body : (response.data ?? null);
  return { status, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function post(
  options: FetchEndpointOptions,
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

function readStartResponse(body: unknown, provider: string): StartResult {
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
    return { kind: 'connection', provider, key: connectionKey, authorizationUrl: url.toString() };
  }
  if (typeof sessionKey === 'string' && sessionKey !== '') {
    return { kind: 'session', provider, key: sessionKey, authorizationUrl: url.toString() };
  }
  throw new SaltlineError(
    'INVALID_START_RESPONSE',
    'Your start endpoint must answer with init’s connectionKey or sessionKey.',
    { body },
  );
}
