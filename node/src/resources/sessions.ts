import { segment, type Transport } from '../transport.ts';
import type { JsonBody, RequestBody, Session, UserInfo } from '../types.ts';
import type { IntegrationOption } from './connections.ts';

/** End-user sign-in sessions (OAuth2 with PKCE). */
export class Sessions {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Starts a sign-in. Keep `codeVerifier` for `claim`; send the user to `authorizationUrl`. */
  init(
    provider: string,
    body: RequestBody<'initSession'>,
    options: IntegrationOption = {},
  ): Promise<JsonBody<'initSession'>> {
    return this.#transport.json({
      method: 'POST',
      path: `auth/${segment(provider)}/init`,
      headers: { 'x-saltline-integration-key': options.integrationKey },
      body,
    });
  }

  /** Returns the signed-in user. Single use; expires 30 min after the provider step. */
  claim(provider: string, sessionKey: string, codeVerifier: string): Promise<UserInfo> {
    return this.#transport.json({
      method: 'POST',
      path: `auth/${segment(provider)}/claim`,
      headers: { 'x-saltline-session-key': sessionKey },
      body: { codeVerifier } satisfies RequestBody<'claimSession'>,
    });
  }

  /** Fetches the user for an active session, live from the provider. */
  userinfo(
    provider: string,
    sessionKey: string,
    options: IntegrationOption = {},
  ): Promise<UserInfo> {
    return this.#transport.json({
      method: 'POST',
      path: `auth/${segment(provider)}/userinfo`,
      headers: {
        'x-saltline-session-key': sessionKey,
        'x-saltline-integration-key': options.integrationKey,
      },
    });
  }

  /** Refreshes tokens. Throws `CONFLICT` if a refresh is in flight. */
  async refresh(provider: string, sessionKey: string): Promise<Session> {
    const result = await this.#transport.json<JsonBody<'refreshSession'>>({
      method: 'POST',
      path: `auth/${segment(provider)}/refresh`,
      headers: { 'x-saltline-session-key': sessionKey },
    });
    return result.session;
  }

  /** Revokes the session at the provider. */
  async revoke(
    provider: string,
    sessionKey: string,
    options: IntegrationOption = {},
  ): Promise<void> {
    await this.#transport.json<JsonBody<'revokeSession'>>({
      method: 'DELETE',
      path: `auth/${segment(provider)}/revoke`,
      headers: {
        'x-saltline-session-key': sessionKey,
        'x-saltline-integration-key': options.integrationKey,
      },
    });
  }

  /** Lists this provider's sessions, optionally for one integration. */
  async list(provider: string, options: IntegrationOption = {}): Promise<Session[]> {
    const result = await this.#transport.json<JsonBody<'listSessions'>>({
      method: 'GET',
      path: `auth/${segment(provider)}/sessions`,
      headers: { 'x-saltline-integration-key': options.integrationKey },
    });
    return result.sessions;
  }
}

/** Creates a PKCE verifier and S256 challenge. */
export async function createPkce(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}> {
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return {
    codeVerifier,
    codeChallenge: base64Url(new Uint8Array(digest)),
    codeChallengeMethod: 'S256',
  };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
