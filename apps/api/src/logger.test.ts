import { describe, expect, it } from "vitest";
import { buildLoggerOptions } from "./logger.js";

describe("buildLoggerOptions", () => {
  it("redacts credential-bearing request headers", () => {
    const options = buildLoggerOptions();
    expect(options.redact.paths).toContain("req.headers.authorization");
    expect(options.redact.paths).toContain("req.headers.cookie");
    expect(options.redact.censor).toBe("[REDACTED]");
  });

  it("defaults to info level in production and debug in dev", () => {
    expect(buildLoggerOptions({ isDev: false }).level).toBe("info");
    expect(buildLoggerOptions({ isDev: true }).level).toBe("debug");
  });

  it("honors a valid LOG_LEVEL value", () => {
    expect(buildLoggerOptions({ isDev: false, level: "warn" }).level).toBe("warn");
    expect(buildLoggerOptions({ isDev: true, level: "trace" }).level).toBe("trace");
  });

  it("falls back to the default when LOG_LEVEL is not a pino level", () => {
    expect(buildLoggerOptions({ isDev: false, level: "verbose" }).level).toBe("info");
    expect(buildLoggerOptions({ isDev: true, level: "" }).level).toBe("debug");
  });
});
