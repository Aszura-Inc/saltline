import { SaltlineError } from '../errors.ts';
import { segment, type Transport } from '../transport.ts';
import type { JsonBody } from '../types.ts';

export interface ProxyRequest {
  /** The connected account to act as. */
  connectionKey: string;
  /** Default `GET`. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  /** Sent as JSON; `contentType` sets the provider's format. */
  body?: unknown;
  /** Provider query string. */
  query?: Record<string, string | undefined>;
  /** Provider headers, e.g. `Accept`. */
  headers?: Record<string, string>;
  /** Only needed when the provider has several integrations and no default. */
  integrationKey?: string;
  /** Provider API version to pin; see `x-saltline-version-served`. */
  version?: string;
  /** Body format for the provider, e.g. `application/x-www-form-urlencoded`. */
  contentType?: string;
}

/** Calls provider APIs with the connection's credentials. */
export class ProviderProxy {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Returns the provider's response as-is. Provider errors are returned, not thrown; only
   * Saltline's own refusals throw.
   */
  async fetch(provider: string, path: string, request: ProxyRequest): Promise<Response> {
    const response = await this.#transport.send(this.#build(provider, path, request));
    // Only Saltline's own errors carry this header.
    if (response.headers.has('x-saltline-error-code')) {
      throw await SaltlineError.fromResponse(response);
    }
    return response;
  }

  /** Async call; the response is POSTed to `callbackUrl`. Verify it with `verifyWebhook`. */
  async enqueue(
    provider: string,
    path: string,
    request: ProxyRequest & { callbackUrl: string },
  ): Promise<JsonBody<'proxyGet', 202>> {
    const built = this.#build(provider, path, request);
    built.headers = { ...built.headers, 'x-saltline-callback-url': request.callbackUrl };
    const response = await this.#transport.send(built);
    if (response.status !== 202) throw await SaltlineError.fromResponse(response);
    return (await response.json()) as JsonBody<'proxyGet', 202>;
  }

  #build(provider: string, path: string, request: ProxyRequest) {
    const providerPath = path.replace(/^\/+/, '');
    if (providerPath === '' || providerPath.split('/').includes('..')) {
      throw new TypeError('Saltline: the proxy path must be a non-empty provider API path.');
    }

    // Drop caller x-saltline-* headers so they can't override the connection key or callback.
    const providerHeaders = Object.fromEntries(
      Object.entries(request.headers ?? {}).filter(
        ([name]) => !name.toLowerCase().startsWith('x-saltline-'),
      ),
    );

    return {
      method: request.method ?? 'GET',
      path: `proxy/${segment(provider)}/${providerPath}`,
      query: request.query,
      headers: {
        ...providerHeaders,
        'x-saltline-connection-key': request.connectionKey,
        'x-saltline-integration-key': request.integrationKey,
        'x-saltline-version': request.version,
        'x-saltline-content-type': request.contentType,
      } as Record<string, string | undefined>,
      body: request.body,
    };
  }
}
