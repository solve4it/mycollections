/**
 * PKCE (RFC 7636) helpers for the Authorization Code flow. Uses the Web Crypto
 * API available as a global in Node >= 24 and in browsers, so the same code runs
 * on desktop and web with no native dependency.
 */

// 64 characters, all drawn from the PKCE/URI unreserved set, so a 6-bit mask
// (`byte & 63`) selects each one with uniform probability (no modulo bias).
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returns a cryptographically random string of `length` characters drawn from
 * the URL-safe unreserved set. Suitable for PKCE verifiers, `state`, and `nonce`.
 */
export function randomUrlSafe(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: `byte & 63` is always 0..63, in range
    out += URL_SAFE[byte & 63]!;
  }
  return out;
}

/** Computes the base64url-encoded SHA-256 digest of the input (PKCE S256). */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

/** Creates a PKCE verifier/challenge pair using the S256 method. */
export async function createPkcePair(): Promise<PkcePair> {
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}
