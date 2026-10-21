// x-saltline-hmac-256 = hex HMAC-SHA256(base64-decoded secret, timestamp + raw body).
// During secret rotation it holds two comma-separated signatures.

const DEFAULT_TOLERANCE_SECONDS = 300;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface VerifySignatureInput {
  /** Raw body as received; re-serialized JSON won't verify. */
  body: string | Uint8Array;
  /** The `x-saltline-timestamp` header. */
  timestamp: string | null | undefined;
  /** The `x-saltline-hmac-256` header. */
  signature: string | null | undefined;
  /** Base64 signing secret, or several while rotating. */
  secrets: string | readonly string[];
  /** Allowed clock skew in seconds. Default 300. */
  toleranceSeconds?: number;
  /** For tests. */
  now?: Date;
}

/** True if the signature matches and the timestamp is in tolerance. Never throws. */
export async function verifySignature(input: VerifySignatureInput): Promise<boolean> {
  const { timestamp, signature } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!timestamp || !signature) return false;

  // Strict ISO 8601 with zone; Date.parse is too lenient. Same pattern as the PHP SDK.
  if (!ISO_TIMESTAMP.test(timestamp)) return false;
  const signedAt = Date.parse(timestamp);
  if (Number.isNaN(signedAt)) return false;

  const now = (input.now ?? new Date()).getTime();
  if (Math.abs(now - signedAt) > tolerance * 1000) return false;

  const candidates = signature
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (candidates.length === 0) return false;

  const encoder = new TextEncoder();
  const timestampBytes = encoder.encode(timestamp);
  const bodyBytes = typeof input.body === 'string' ? encoder.encode(input.body) : input.body;
  const message = new Uint8Array(timestampBytes.length + bodyBytes.length);
  message.set(timestampBytes, 0);
  message.set(bodyBytes, timestampBytes.length);

  const secrets = typeof input.secrets === 'string' ? [input.secrets] : input.secrets;

  for (const secret of secrets) {
    const expected = await hmacHex(secret, message);
    if (expected === null) continue;
    for (const candidate of candidates) {
      if (constantTimeEqual(expected, candidate)) return true;
    }
  }

  return false;
}

/** Verifies a Saltline API response. Reads a clone, so the body stays unread. */
export async function verifyResponse(
  response: Response,
  secrets: string | readonly string[],
  options: Pick<VerifySignatureInput, 'toleranceSeconds' | 'now'> = {},
): Promise<boolean> {
  const body = new Uint8Array(await response.clone().arrayBuffer());
  return verifySignature({
    body,
    timestamp: response.headers.get('x-saltline-timestamp'),
    signature: response.headers.get('x-saltline-hmac-256'),
    secrets,
    ...options,
  });
}

/** Verifies a webhook delivery or proxy callback. Use the raw body, not parsed JSON. */
export async function verifyWebhook(
  headers: Headers | Record<string, string | string[] | undefined>,
  rawBody: string | Uint8Array,
  secrets: string | readonly string[],
  options: Pick<VerifySignatureInput, 'toleranceSeconds' | 'now'> = {},
): Promise<boolean> {
  return verifySignature({
    body: rawBody,
    timestamp: readHeader(headers, 'x-saltline-timestamp'),
    signature: readHeader(headers, 'x-saltline-hmac-256'),
    secrets,
    ...options,
  });
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function hmacHex(secretBase64: string, message: Uint8Array): Promise<string | null> {
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secretBase64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
