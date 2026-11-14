import { describe, expect, it } from "vitest";
import { isPairingEnabled, PAIRING_TTL_MS, PairingCodes, pairingLink } from "./pairing.js";

const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("PairingCodes", () => {
  it("mints a 256-bit base64url code", () => {
    expect(new PairingCodes().mint()).toMatch(CODE_SHAPE);
  });

  it("redeems the current code once, and never again (#241: a code cannot be replayed)", () => {
    const codes = new PairingCodes();
    const code = codes.mint();
    expect(codes.redeem(code)).toBe(true);
    expect(codes.redeem(code)).toBe(false);
  });

  it("refuses a wrong code without burning the real one, so nobody can block pairing by guessing", () => {
    const codes = new PairingCodes();
    const code = codes.mint();
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(codes.redeem(`${"x".repeat(42)}${attempt % 10}`)).toBe(false);
    }
    expect(codes.redeem(code)).toBe(true);
  });

  it("refuses a code after its fifteen minutes are up", () => {
    const time = clock();
    const codes = new PairingCodes({ now: time.now });
    const code = codes.mint();
    time.advance(PAIRING_TTL_MS - 1);
    expect(codes.redeem(code)).toBe(true);

    const late = codes.mint();
    time.advance(PAIRING_TTL_MS);
    expect(codes.redeem(late)).toBe(false);
  });

  it("keeps one code at a time: minting a new one retires the old", () => {
    const codes = new PairingCodes();
    const first = codes.mint();
    const second = codes.mint();
    expect(second).not.toBe(first);
    expect(codes.redeem(first)).toBe(false);
    expect(codes.redeem(second)).toBe(true);
  });

  it("refuses everything before any code is minted", () => {
    expect(new PairingCodes().redeem("a".repeat(43))).toBe(false);
  });
});

describe("pairingLink", () => {
  it("carries the code in the fragment, which never reaches a server log or a Referer header", () => {
    const code = "a".repeat(43);
    const link = new URL(pairingLink("http://localhost:5173", code));
    expect(link.origin).toBe("http://localhost:5173");
    expect(link.pathname).toBe("/setup");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#pair=${code}`);
  });
});

describe("isPairingEnabled", () => {
  const dev = { isDev: true, allowedHosts: undefined, dbPath: "/data/app.db" } as const;

  it("is on for a development server on loopback with a database on disk", () => {
    expect(isPairingEnabled(dev)).toBe(true);
  });

  it("is off outside development, where API_TOKEN is the only way in (#248)", () => {
    expect(isPairingEnabled({ ...dev, isDev: false })).toBe(false);
  });

  it("is off on a non-loopback bind, where anyone on the network could reach the route", () => {
    expect(isPairingEnabled({ ...dev, allowedHosts: false })).toBe(false);
  });

  it("is off for an in-memory database, whose per-run token the e2e suite pins anyway", () => {
    expect(isPairingEnabled({ ...dev, dbPath: ":memory:" })).toBe(false);
  });
});
