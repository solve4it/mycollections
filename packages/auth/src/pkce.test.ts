import { describe, expect, it } from "vitest";
import { createPkcePair, randomUrlSafe, sha256Base64Url } from "./pkce.js";

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;
const BASE64URL = /^[A-Za-z0-9\-_]+$/;

describe("randomUrlSafe", () => {
  it("produces unreserved characters only", () => {
    expect(randomUrlSafe(32)).toMatch(UNRESERVED);
  });

  it("produces a string of the requested length", () => {
    expect(randomUrlSafe(43)).toHaveLength(43);
  });

  it("is non-repeating across calls", () => {
    expect(randomUrlSafe(32)).not.toBe(randomUrlSafe(32));
  });
});

describe("sha256Base64Url", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    // verifier and expected S256 challenge from RFC 7636 Appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await sha256Base64Url(verifier)).toBe(expected);
  });

  it("emits base64url with no padding", async () => {
    const challenge = await sha256Base64Url("some-verifier");
    expect(challenge).toMatch(BASE64URL);
    expect(challenge).not.toContain("=");
  });
});

describe("createPkcePair", () => {
  it("creates a verifier of valid length and an S256 challenge", async () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = await createPkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(UNRESERVED);
    expect(codeChallengeMethod).toBe("S256");
    expect(codeChallenge).toBe(await sha256Base64Url(codeVerifier));
  });

  it("creates a unique pair each time", async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});
