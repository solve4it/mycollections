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
