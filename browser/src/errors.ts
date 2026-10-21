export type SaltlineErrorCode =
  /** Start endpoint failed or was unreachable. */
  | 'START_FAILED'
  /** Start endpoint returned no valid authorizationUrl or key. */
  | 'INVALID_START_RESPONSE'
  /** Finish endpoint failed or was unreachable. */
  | 'FINISH_FAILED'
  /** sessionStorage blocked (private mode, sandboxed iframe). */
  | 'STORAGE_UNAVAILABLE'
  /** No verifier in this tab: other tab/browser, already used, or unknown key. */
  | 'VERIFIER_NOT_FOUND';

/** Browser-side failure. Provider errors aren't thrown; finish returns `{ ok: false }`. */
export class SaltlineError extends Error {
  readonly code: SaltlineErrorCode;
  /** Endpoint HTTP status, if any. */
  readonly status: number | null;
  /** Endpoint response body, parsed if JSON. */
  readonly body: unknown;

  constructor(
    code: SaltlineErrorCode,
    message: string,
    init: { status?: number | null; body?: unknown; cause?: unknown } = {},
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'SaltlineError';
    this.code = code;
    this.status = init.status ?? null;
    this.body = init.body;
  }
}
