import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./api-client.js";
import {
  errorReporter,
  isErrorReportingEnabled,
  onRouterCatch,
  registerGlobalErrorHandlers,
  reportQueryError,
  setErrorReportingEnabled,
} from "./error-reporter.js";

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

function lastReportJson(): string {
  return JSON.stringify(consoleSpy.mock.calls.at(-1));
}

describe("error reporting opt-out", () => {
  it("is enabled by default", () => {
    expect(isErrorReportingEnabled()).toBe(true);
  });

  it("persists opt-out to localStorage so it survives reloads", () => {
    setErrorReportingEnabled(false);
    expect(isErrorReportingEnabled()).toBe(false);
    expect(localStorage.getItem("error_reporting_enabled")).toBe("false");
    setErrorReportingEnabled(true);
    expect(isErrorReportingEnabled()).toBe(true);
  });

  it("stops the reporter immediately when disabled", () => {
    errorReporter.capture(new Error("before opt-out"));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    setErrorReportingEnabled(false);
    errorReporter.capture(new Error("after opt-out"));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("registerGlobalErrorHandlers", () => {
  it("captures window error events with a source tag", () => {
    registerGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window boom") }));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(lastReportJson()).toContain("window boom");
    expect(lastReportJson()).toContain("window");
  });

  it("captures unhandled rejections, normalizing non-Error reasons without embedding their contents", () => {
    registerGlobalErrorHandlers();
    const event = new Event("unhandledrejection") as Event & { reason: unknown };
    event.reason = { collectionName: "Rare Vinyl" };
    window.dispatchEvent(event);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(lastReportJson()).not.toContain("Rare Vinyl");
    expect(lastReportJson()).toContain("unhandledrejection");
  });

  it("is idempotent — registering twice reports each event once", () => {
    registerGlobalErrorHandlers();
    registerGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("once") }));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("onRouterCatch", () => {
  it("captures router render errors with a router source tag", () => {
    onRouterCatch(new Error("render boom"));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(lastReportJson()).toContain("render boom");
    expect(lastReportJson()).toContain("router");
  });
});

describe("reportQueryError", () => {
  it("captures API failures with a query source tag", () => {
    reportQueryError(new Error("fetch exploded"));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(lastReportJson()).toContain("fetch exploded");
    expect(lastReportJson()).toContain("query");
  });

  it("skips 401s — they are handled by auth recovery, not crashes", () => {
    reportQueryError(new UnauthorizedError());
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
