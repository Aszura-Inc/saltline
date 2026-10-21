import { SaltlineError } from './errors.ts';

export const BASE_URLS = {
  production: 'https://api.saltline.dev/v1',
  staging: 'https://api-staging.saltline.dev/v1',
} as const;

export type SaltlineEnvironment = keyof typeof BASE_URLS;

export interface SaltlineOptions {
  /** Secret API key. Server-side only. */
  apiKey: string;
  /** Default `production`. */
  environment?: SaltlineEnvironment;
  /** Overrides `environment`. Include `/v1`. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface TransportRequest {
  method: string;
  /** Relative to the base URL, already encoded. */
  path: string;
  headers?: Record<string, string | null | undefined>;
  query?: Record<string, string | null | undefined>;
  /** Sent as JSON. */
  body?: unknown;
}

/** Encodes one path segment so it can't change the route. */
export function segment(value: string): string {
  if (value === '') throw new TypeError('Saltline: a path segment cannot be empty.');
  return encodeURIComponent(value);
}

export class Transport {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: SaltlineOptions) {
    if (typeof options.apiKey !== 'string' || options.apiKey.trim() === '') {
      throw new TypeError('Saltline: `apiKey` is required.');
    }
    this.#apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? BASE_URLS[options.environment ?? 'production']).replace(
      /\/+$/,
      '',
    );
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('Saltline: no global fetch — pass `fetch` in the options.');
    }
    this.#fetch = fetchImpl;
  }

  url(path: string, query?: TransportRequest['query']): string {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) params.append(key, value);
    }
    const search = params.toString();
    return search === '' ? url : `${url}${url.includes('?') ? '&' : '?'}${search}`;
  }

  /** Returns the raw response, any status. */
  async send(request: TransportRequest): Promise<Response> {
    const headers = new Headers({ Authorization: `Bearer ${this.#apiKey}` });
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (value !== null && value !== undefined) headers.set(name, value);
    }

    let body: string | undefined;
    if (request.body !== undefined) {
      body = JSON.stringify(request.body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }

    return this.#fetch(this.url(request.path, request.query), {
      method: request.method,
      headers,
      body,
    });
  }

  /** Returns the parsed JSON body; throws SaltlineError on non-2xx. */
  async json<T>(request: TransportRequest): Promise<T> {
    const response = await this.send(request);
    if (!response.ok) throw await SaltlineError.fromResponse(response);
    return (await response.json()) as T;
  }
}
