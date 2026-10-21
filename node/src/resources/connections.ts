import { segment, type Transport } from '../transport.ts';
import type { Connection, JsonBody, RequestBody } from '../types.ts';

export interface IntegrationOption {
  /** Only needed when the provider has several integrations and no default. */
  integrationKey?: string;
}

/** Users' connected provider accounts. */
export class Connections {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Starts a connection. Send the user to `authorizationUrl`, then `claim` on return. */
  init(
    provider: string,
    body: RequestBody<'initConnection'>,
    options: IntegrationOption = {},
  ): Promise<JsonBody<'initConnection'>> {
    return this.#transport.json({
      method: 'POST',
      path: `connections/${segment(provider)}/init`,
      headers: { 'x-saltline-integration-key': options.integrationKey },
      body,
    });
  }

  /**
   * Activates the connection with the PKCE verifier. Single use; expires 30 min after the provider
   * step. Throws `CONNECTION_NOT_FOUND` or `CODE_VERIFIER_MISMATCH`.
   */
  async claim(provider: string, connectionKey: string, codeVerifier: string): Promise<Connection> {
    const result = await this.#transport.json<JsonBody<'claimConnection'>>({
      method: 'POST',
      path: `connections/${segment(provider)}/claim`,
      headers: { 'x-saltline-connection-key': connectionKey },
      body: { codeVerifier } satisfies RequestBody<'claimConnection'>,
    });
    return result.connection;
  }

  /** Refreshes OAuth2 tokens. Throws `CONFLICT` if a refresh is in flight. */
  async refresh(provider: string, connectionKey: string): Promise<Connection> {
    const result = await this.#transport.json<JsonBody<'refreshConnection'>>({
      method: 'POST',
      path: `connections/${segment(provider)}/refresh`,
      headers: { 'x-saltline-connection-key': connectionKey },
    });
    return result.connection;
  }

  /** Revokes the connection at the provider and disconnects it. */
  async revoke(
    provider: string,
    connectionKey: string,
    options: IntegrationOption = {},
  ): Promise<void> {
    await this.#transport.json<JsonBody<'revokeConnection'>>({
      method: 'DELETE',
      path: `connections/${segment(provider)}/revoke`,
      headers: {
        'x-saltline-connection-key': connectionKey,
        'x-saltline-integration-key': options.integrationKey,
      },
    });
  }

  /** Lists an integration's connections for this provider. */
  async list(provider: string, options: { integrationKey: string }): Promise<Connection[]> {
    const result = await this.#transport.json<JsonBody<'listConnections'>>({
      method: 'GET',
      path: `connections/${segment(provider)}/connections`,
      headers: { 'x-saltline-integration-key': options.integrationKey },
    });
    return result.connections;
  }
}

export type ConnectionRedirect =
  | { ok: true; connectionKey: string }
  | { ok: false; error: string; errorMessage: string | null };

/** Parses the `redirectUrl` a user lands on after connecting. */
export function parseConnectionRedirect(url: string | URL): ConnectionRedirect {
  const params = new URL(url).searchParams;
  const error = params.get('error');
  if (error !== null) {
    return { ok: false, error, errorMessage: params.get('error_message') };
  }
  const connectionKey = params.get('connectionKey');
  if (connectionKey === null || connectionKey === '') {
    return { ok: false, error: 'missing_connection_key', errorMessage: null };
  }
  return { ok: true, connectionKey };
}
