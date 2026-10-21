export interface Pkce {
  /** Secret; only finish sends it. */
  codeVerifier: string;
  /** Sent to init. */
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/** New S256 PKCE pair. */
export async function createPkce(): Promise<Pkce> {
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  return {
    codeVerifier,
    codeChallenge: await pkceChallenge(codeVerifier),
    codeChallengeMethod: 'S256',
  };
}

/** S256 challenge for a verifier. */
export async function pkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
