import { describe, expect, it, vi } from "vitest";

// Core's tsconfig has no runtime lib (see error-reporter.ts); vitest runs in Node where console exists.
declare const console: { error: (...data: unknown[]) => void };

import {
  buildErrorReport,
  createErrorReporter,
  type ErrorReport,
  SAFE_CONTEXT_KEYS,
  toReportableError,
} from "./error-reporter.js";

describe("buildErrorReport", () => {
  it("captures name, message, and stack from the error", () => {
    const error = new TypeError("boom");
    const report = buildErrorReport(error);
    expect(report.name).toBe("TypeError");
    expect(report.message).toBe("boom");
    expect(report.stack).toBe(error.stack);
    expect(report.context).toEqual({});
  });

  it("keeps only allowlisted context keys", () => {
    const report = buildErrorReport(new Error("x"), {
      route: "/api/collections/:id",
      method: "GET",
      statusCode: 500,
      // Anything not on the allowlist must be dropped: collection data,
      // request bodies, tokens, emails, etc. must never reach a report.
      body: { name: "Rare Vinyl", value: 500 },
      email: "user@example.com",
      authorization: "Bearer secret-token",
    });
    expect(report.context).toEqual({
      route: "/api/collections/:id",
      method: "GET",
      statusCode: 500,
    });
  });

  it("drops allowlisted keys whose values are not primitives", () => {
    const report = buildErrorReport(new Error("x"), {
      route: { nested: "object" },
      statusCode: 503,
    });
    expect(report.context).toEqual({ statusCode: 503 });
  });

  it("exposes the allowlist so wiring code can build safe context", () => {
    expect(SAFE_CONTEXT_KEYS).toContain("route");
    expect(SAFE_CONTEXT_KEYS).toContain("componentStack");
    expect(SAFE_CONTEXT_KEYS).toContain("reqId");
    expect(SAFE_CONTEXT_KEYS).not.toContain("body");
  });

  it("truncates oversized messages and stacks", () => {
    const error = new Error("m".repeat(5_000));
    error.stack = "s".repeat(10_000);
    const report = buildErrorReport(error);
    expect(report.message).toHaveLength(1_000);
    expect(report.stack).toHaveLength(4_000);
  });
});

describe("toReportableError", () => {
  it("returns Error instances unchanged", () => {
    const error = new RangeError("out of range");
    expect(toReportableError(error)).toBe(error);
  });

  it("does not stringify non-Error values — only the type name survives", () => {
    const reason = { name: "Rare Vinyl", price: 500 };
    const error = toReportableError(reason);
    expect(error.message).toBe("Non-Error thrown value of type Object");
    expect(error.message).not.toContain("Rare Vinyl");
  });

  it.each([
    [null, "null"],
    ["a string secret", "string"],
    [42, "number"],
  ])("describes %s as type %s without embedding the value", (reason, typeName) => {
    const error = toReportableError(reason);
    expect(error.message).toBe(`Non-Error thrown value of type ${typeName}`);
    expect(error.message).not.toContain("secret");
  });
});

describe("createErrorReporter", () => {
  it("sends a sanitized report to the sink", () => {
    const sink = vi.fn<(report: ErrorReport) => void>();
    const reporter = createErrorReporter({ sink });
    reporter.capture(new Error("boom"), { route: "/x", secret: "do-not-report" });
    expect(sink).toHaveBeenCalledTimes(1);
    const report = sink.mock.calls[0]?.[0];
    expect(report?.message).toBe("boom");
    expect(report?.context).toEqual({ route: "/x" });
  });

  it("does nothing when isEnabled returns false", () => {
    const sink = vi.fn();
    const reporter = createErrorReporter({ sink, isEnabled: () => false });
    reporter.capture(new Error("boom"));
    expect(sink).not.toHaveBeenCalled();
  });

  it("re-checks isEnabled on every capture so opt-out applies immediately", () => {
    const sink = vi.fn();
    let enabled = true;
    const reporter = createErrorReporter({ sink, isEnabled: () => enabled });
    reporter.capture(new Error("first"));
    enabled = false;
    reporter.capture(new Error("second"));
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("never throws when the sink fails — reporting must not break the app", () => {
    const reporter = createErrorReporter({
      sink: () => {
        throw new Error("sink down");
      },
    });
    expect(() => reporter.capture(new Error("boom"))).not.toThrow();
  });

  it("defaults to a console.error sink", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const reporter = createErrorReporter();
      reporter.capture(new Error("boom"));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(spy.mock.calls[0])).toContain("boom");
    } finally {
      spy.mockRestore();
    }
  });
});
