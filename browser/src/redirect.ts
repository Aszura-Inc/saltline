export type FlowKind = 'connection' | 'session';

export type SaltlineRedirect =
  | { ok: true; kind: FlowKind; key: string }
  | { ok: false; error: string; errorMessage: string | null };

/** Query params Saltline adds to the redirectUrl. */
export const REDIRECT_PARAMS = ['connectionKey', 'sessionKey', 'error', 'error_message'] as const;

/** Parses a Saltline redirect URL; null if it isn't one. */
export function parseRedirect(url: string | URL): SaltlineRedirect | null {
  const params = new URL(url).searchParams;

  const error = params.get('error');
  if (error !== null && error !== '') {
    return { ok: false, error, errorMessage: params.get('error_message') };
  }

  const connectionKey = params.get('connectionKey');
  if (connectionKey !== null && connectionKey !== '') {
    return { ok: true, kind: 'connection', key: connectionKey };
  }
  const sessionKey = params.get('sessionKey');
  if (sessionKey !== null && sessionKey !== '') {
    return { ok: true, kind: 'session', key: sessionKey };
  }
  return null;
}

/** URL with Saltline's params removed. */
export function stripRedirectParams(url: string | URL): string {
  return stripped(url).toString();
}

/** Path, search and hash with Saltline's params removed: what a router's `navigate` takes. */
export function redirectPath(url: string | URL): string {
  const clean = stripped(url);
  return clean.pathname + clean.search + clean.hash;
}

function stripped(url: string | URL): URL {
  const clean = new URL(url);
  for (const name of REDIRECT_PARAMS) clean.searchParams.delete(name);
  return clean;
}
