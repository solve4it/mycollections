import { describe, expect, it } from "vitest";
import { resolveServerConfig, startupWarnings } from "./config.js";

/** Only the variables under test; everything else falls back to a default. */
function resolve(env: Record<string, string | undefined> = {}) {
  return resolveServerConfig(env);
}

describe("resolveServerConfig", () => {
  it("defaults to a loopback bind on port 3001 with a generated token", () => {
    const config = resolve();
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.isDev).toBe(true);
    expect(config.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(config.dbPath.endsWith("/data/app.db")).toBe(true);
  });

  it("generates a different token on each call", () => {
    expect(resolve().token).not.toBe(resolve().token);
  });

  it("reads the supported overrides", () => {
    const config = resolve({
      DB_PATH: "/tmp/probe.db",
      PORT: "4000",
      HOST: "::1",
      API_TOKEN: "explicit-token",
      NODE_ENV: "production",
    });
    expect(config).toMatchObject({
      dbPath: "/tmp/probe.db",
      port: 4000,
      host: "::1",
      token: "explicit-token",
      isDev: false,
    });
  });

  it("allows PORT=0 so the OS assigns a free port", () => {
    // The web↔API integration test spawns the real server this way.
    expect(resolve({ PORT: "0" }).port).toBe(0);
  });

  it("keeps ':memory:' as a database path", () => {
    expect(resolve({ DB_PATH: ":memory:" }).dbPath).toBe(":memory:");
  });

  // `process.env.X ?? default` only catches undefined. An exported-but-empty variable
  // is a string, so `HOST=""` reached app.listen() as "" — which binds every
  // interface, the exact exposure the bind guard exists to prevent.
  it.each(["HOST", "PORT", "API_TOKEN", "DB_PATH"])("treats an empty %s as unset", (name) => {
    const config = resolve({ [name]: "" });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.token).toHaveLength(36);
    expect(config.dbPath.endsWith("/data/app.db")).toBe(true);
  });

  it.each(["not-a-number", "70000", "-1", "3001.5"])("rejects the invalid port %s", (port) => {
    expect(() => resolve({ PORT: port })).toThrow(/PORT/);
  });

  describe("non-loopback binds", () => {
    const STRONG_TOKEN = "a".repeat(32);

    it.each(["0.0.0.0", "::", "192.168.1.20", "example.test"])(
      "refuses to bind %s without an explicit API_TOKEN",
      (host) => {
        expect(() => resolve({ HOST: host })).toThrow(/API_TOKEN/);
      },
    );

    it("refuses a non-loopback bind with a guessable token", () => {
      // DEVELOPMENT.md suggests API_TOKEN=dev-local-token for local work; it must not
      // become the credential guarding a LAN-exposed server.
      expect(() => resolve({ HOST: "0.0.0.0", API_TOKEN: "dev-local-token" })).toThrow(/32/);
    });

    it("allows a non-loopback bind with an explicit strong token", () => {
      expect(resolve({ HOST: "192.168.1.20", API_TOKEN: STRONG_TOKEN })).toMatchObject({
        host: "192.168.1.20",
        token: STRONG_TOKEN,
      });
    });

    // Host pinning cannot know what name a LAN client will use, so binding beyond
    // loopback deliberately turns it off rather than 403-ing every request.
    it("disables Host pinning for a non-loopback bind", () => {
      expect(resolve({ HOST: "0.0.0.0", API_TOKEN: STRONG_TOKEN }).allowedHosts).toBe(false);
    });

    it("leaves Host pinning enabled for loopback binds", () => {
      expect(resolve().allowedHosts).toBeUndefined();
      expect(resolve({ HOST: "::1" }).allowedHosts).toBeUndefined();
    });
  });

  it.each(["127.0.0.1", "127.0.0.53", "localhost", "::1", "[::1]", "LOCALHOST"])(
    "treats %s as loopback, so no token is required",
    (host) => {
      expect(() => resolve({ HOST: host })).not.toThrow();
    },
  );

  // Outside development the token is never printed, so a generated one is known to
  // nobody: the server would bind, look healthy, and 401 everything (#241).
  describe("outside development", () => {
    it.each([
      ["unset", {}],
      ["empty", { API_TOKEN: "" }],
    ])("refuses to start with an %s API_TOKEN", (_name, env) => {
      expect(() => resolve({ NODE_ENV: "production", ...env })).toThrow(/API_TOKEN/);
    });

    it("starts with an explicit token", () => {
      expect(resolve({ NODE_ENV: "production", API_TOKEN: "explicit-token" })).toMatchObject({
        token: "explicit-token",
        isDev: false,
      });
    });

    // The 32-character floor guards network-reachable binds only; a short token on
    // loopback is the operator's call.
    it("does not impose the non-loopback length floor on a loopback production bind", () => {
      expect(() => resolve({ NODE_ENV: "production", API_TOKEN: "short" })).not.toThrow();
    });

    it("still generates a token in development, where it is printed on startup", () => {
      expect(resolve().token).toHaveLength(36);
    });
  });
});

describe("startupWarnings", () => {
  const STRONG_TOKEN = "a".repeat(32);

  it.each([
    ["the default loopback development setup", {}],
    ["a loopback production start with a token", { NODE_ENV: "production", API_TOKEN: "explicit-token" }],
  ])("is silent for %s", (_name, env) => {
    expect(startupWarnings(resolve(env))).toEqual([]);
  });

  // A replaced CORS allowlist is otherwise invisible: the browser blocks the call and
  // the server answers with no header, so neither side says why (#327).
  it("warns that DEV_ORIGINS replaced the default allowlist", () => {
    const warnings = startupWarnings(resolve({ DEV_ORIGINS: "http://localhost:5199" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("http://localhost:5199");
    expect(warnings[0]).toContain("DEV_ORIGINS");
  });

  it("stays silent when DEV_ORIGINS names the defaults in another order", () => {
    const value = "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173";
    expect(startupWarnings(resolve({ DEV_ORIGINS: value }))).toEqual([]);
  });

  it("warns about a non-loopback bind", () => {
    const warnings = startupWarnings(resolve({ HOST: "0.0.0.0", API_TOKEN: STRONG_TOKEN }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("0.0.0.0");
  });

  it("never includes the token itself", () => {
    const config = resolve({ HOST: "0.0.0.0", API_TOKEN: STRONG_TOKEN });
    const warnings = startupWarnings(config);
    expect(warnings).not.toEqual([]);
    for (const warning of warnings) {
      expect(warning).not.toContain(config.token);
    }
  });
});

// The dev CORS allowlist was hardcoded to 5173/4173, so a second instance on any other
// port was silently blocked — the page loaded and every API call failed with nothing
// said anywhere (#327). DEV_ORIGINS makes the list configurable without widening it.
describe("DEV_ORIGINS", () => {
  it("defaults to the Vite dev and preview origins", () => {
    expect(resolve().devOrigins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ]);
  });

  it("replaces the defaults with the configured origins", () => {
    const config = resolve({ DEV_ORIGINS: "http://localhost:5199, http://127.0.0.1:5199" });
    expect(config.devOrigins).toEqual(["http://localhost:5199", "http://127.0.0.1:5199"]);
  });

  it("normalizes each entry to its origin", () => {
    expect(resolve({ DEV_ORIGINS: "HTTP://LOCALHOST:5199/,http://[::1]:5199" }).devOrigins).toEqual([
      "http://localhost:5199",
      "http://[::1]:5199",
    ]);
  });

  // What is stored is the parsed origin, never the raw entry, so every spelling of the
  // same loopback origin collapses to the one string a browser actually sends. Locks
  // out anyone "hardening" this later into a match on the raw input, which would make
  // these spellings either dead entries or — worse — separate ones.
  it.each([
    ["hexadecimal IPv4", "http://0x7f000001:5199"],
    ["integer IPv4", "http://2130706433:5199"],
    ["short IPv4", "http://127.1:5199"],
    ["zero-padded IPv4", "http://127.000.000.001:5199"],
  ])("normalizes the %s form to the address a browser sends", (_name, value) => {
    expect(resolve({ DEV_ORIGINS: value }).devOrigins).toEqual(["http://127.0.0.1:5199"]);
  });

  it.each([
    ["percent-encoding", "http://lo%63alhost:5199"],
    ["a confusable letter", "http://ⅼocalhost:5199"],
    // A legal absolute form of the name that no browser ever sends; kept as written it
    // would be an allowlist entry that silently matches nothing.
    ["a trailing dot", "http://localhost.:5199"],
    // WHATWG strips tabs and line breaks while parsing, so the stored entry is clean.
    ["surrounding line breaks", "http://localhost:5199\r\n"],
  ])("normalizes %s to the plain origin", (_name, value) => {
    expect(resolve({ DEV_ORIGINS: value }).devOrigins).toEqual(["http://localhost:5199"]);
  });

  // The IPv4-mapped IPv6 loopback parses to [::ffff:7f00:1], which the loopback test
  // does not recognize, so it is refused rather than quietly allowed. Failing closed on
  // a form nothing sends is the right side to err on; documented so it is not a
  // surprise if someone tries it.
  it("refuses the IPv4-mapped IPv6 loopback form", () => {
    expect(() => resolve({ DEV_ORIGINS: "http://[::ffff:127.0.0.1]:5199" })).toThrow(/not loopback/);
  });

  // Dot segments are resolved before the path is inspected, so this is an origin with
  // no path rather than a rejected entry. Recorded so the behavior is deliberate.
  it("accepts an entry whose path normalizes away", () => {
    expect(resolve({ DEV_ORIGINS: "http://localhost:5199/.." }).devOrigins).toEqual(["http://localhost:5199"]);
  });

  // A default port is elided from an origin, so naming port 80 asks for the origin the
  // default list deliberately omits. It stays the operator's explicit choice: binding
  // below 1024 needs root, and nothing is accepted that was not typed out.
  it("elides a default port, as an origin does", () => {
    expect(resolve({ DEV_ORIGINS: "http://localhost:80,https://localhost:443" }).devOrigins).toEqual([
      "http://localhost",
      "https://localhost",
    ]);
  });

  it("points a rejected non-loopback origin at port forwarding rather than a wider list", () => {
    expect(() => resolve({ DEV_ORIGINS: "http://192.168.1.20:5199" })).toThrow(/forward the port/);
  });

  // Empty means unset everywhere else in this file, and an empty allowlist would be a
  // second silent breakage rather than a fix.
  it.each(["", "   ", ",", " , ,"])("falls back to the defaults for the empty value %j", (value) => {
    expect(resolve({ DEV_ORIGINS: value }).devOrigins).toHaveLength(4);
  });

  // Fail closed and loudly: refusing to start is the one outcome that cannot silently
  // widen the allowlist, and silence is what made #327 expensive to diagnose.
  it.each([
    ["a wildcard", "*"],
    ["the null origin", "null"],
    ["a scheme-relative origin", "//evil.example.com"],
    ["a non-URL", "not-a-url"],
    ["a non-http scheme", "javascript:alert(1)"],
    ["a file URL", "file:///etc/passwd"],
    ["a remote host", "http://evil.example.com"],
    ["a loopback-looking subdomain", "http://localhost:5173.evil.example.com"],
    ["a loopback-looking prefix", "http://127.0.0.1.evil.example.com"],
    ["userinfo smuggling a host", "http://localhost:5173@evil.example.com"],
    ["a fragment", "http://evil.example.com#http://localhost:5173"],
    ["a query", "http://evil.example.com?x=http://localhost:5173"],
    ["a path", "http://localhost:5199/app"],
    ["a non-loopback address", "http://192.168.1.20:5199"],
    ["the unspecified address", "http://0.0.0.0:5199"],
    ["one bad entry among good ones", "http://localhost:5199,http://evil.example.com"],
  ])("refuses to start for %s", (_name, value) => {
    expect(() => resolve({ DEV_ORIGINS: value })).toThrow(/DEV_ORIGINS/);
  });

  it("names the offending entry so the operator can fix it", () => {
    expect(() => resolve({ DEV_ORIGINS: "http://evil.example.com" })).toThrow(/evil\.example\.com/);
  });

  // The variable is dev-only by construction: outside development it is never read, so
  // even a value that would throw in dev cannot change a production start.
  it.each([
    ["a valid value", "http://localhost:5199"],
    ["a wildcard", "*"],
    ["a remote host", "http://evil.example.com"],
  ])("ignores %s outside development", (_name, value) => {
    const config = resolve({ NODE_ENV: "production", API_TOKEN: "explicit-token", DEV_ORIGINS: value });
    expect(config.devOrigins).toEqual([]);
  });
});
