// Shared fixtures (../../tests/fixtures); the PHP SDK runs the same cases.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SaltlineError } from '../src/errors.ts';
import { verifySignature, verifyWebhook } from '../src/signature.ts';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8')) as T;

interface SignatureCase {
  name: string;
  timestamp: string;
  body: string;
  signature: string;
  secrets: string[];
  now: string;
  valid: boolean;
}

interface ErrorCase {
  name: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  expected: { status: number; code: string; message: string; requestId: string | null };
}

describe('signature fixtures', () => {
  const { cases, toleranceSeconds } = fixture<{ cases: SignatureCase[]; toleranceSeconds: number }>(
    'signatures.json',
  );

  for (const c of cases) {
    it(c.name, async () => {
      const result = await verifySignature({
        body: c.body,
        timestamp: c.timestamp,
        signature: c.signature,
        secrets: c.secrets,
        toleranceSeconds,
        now: new Date(c.now),
      });
      assert.equal(result, c.valid);
    });
  }

  it('verifyWebhook reads plain-object headers case-insensitively', async () => {
    const valid = cases.find((c) => c.name === 'valid')!;
    const result = await verifyWebhook(
      { 'X-Saltline-Timestamp': valid.timestamp, 'x-saltline-hmac-256': [valid.signature] },
      valid.body,
      valid.secrets,
      { now: new Date(valid.now) },
    );
    assert.equal(result, true);
  });

  it('a malformed secret fails closed instead of throwing', async () => {
    const valid = cases.find((c) => c.name === 'valid')!;
    const result = await verifySignature({
      ...valid,
      secrets: ['%%%not-base64'],
      now: new Date(valid.now),
    });
    assert.equal(result, false);
  });
});

describe('error fixtures', () => {
  const { cases } = fixture<{ cases: ErrorCase[] }>('errors.json');

  for (const c of cases) {
    it(c.name, () => {
      const error = SaltlineError.fromParts(c.status, new Headers(c.headers), c.body);
      assert.ok(error instanceof Error);
      assert.equal(error.status, c.expected.status);
      assert.equal(error.code, c.expected.code);
      assert.equal(error.message, c.expected.message);
      assert.equal(error.requestId, c.expected.requestId);
    });
  }
});
