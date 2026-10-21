/**
 * An error from Saltline itself. Branch on `code`, not `message`; treat unknown codes by `status`.
 * Provider errors relayed by the proxy are never a SaltlineError.
 */
export class SaltlineError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** Stable code, e.g. `API_KEY_EXPIRED`; `HTTP_<status>` if the body had none. */
  readonly code: string;
  /** `x-saltline-request-id`; include it in support requests. */
  readonly requestId: string | null;
  /** Parsed JSON body, or raw text if not JSON. */
  readonly body: unknown;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    body: unknown;
  }) {
    super(init.message);
    this.name = 'SaltlineError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.body = init.body;
  }

  /** Builds the error from a non-2xx response. Consumes the body. */
  static async fromResponse(response: Response): Promise<SaltlineError> {
    const text = await response.text();
    return SaltlineError.fromParts(response.status, response.headers, text);
  }

  /** Parsing without a `Response`, for the shared fixtures. */
  static fromParts(status: number, headers: Headers, text: string): SaltlineError {
    let body: unknown = text;
    let code: string | null = null;
    let message: string | null = null;

    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON, e.g. an edge or gateway page.
    }

    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.code === 'string' && record.code !== '') code = record.code;
      if (typeof record.error === 'string' && record.error !== '') message = record.error;
    }

    return new SaltlineError({
      status,
      code: code ?? headers.get('x-saltline-error-code') ?? `HTTP_${status}`,
      message: message ?? `Saltline returned HTTP ${status}.`,
      requestId: headers.get('x-saltline-request-id'),
      body,
    });
  }
}
