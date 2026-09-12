import { createErrorReporter, type ErrorReporter, toReportableError } from "@mycollections/core";
import type { ErrorInfo } from "react";
import { UnauthorizedError } from "./api-client.js";
import { readSetting, writeSetting } from "./storage.js";

const STORAGE_KEY = "error_reporting_enabled";

/**
 * Enabled unless the user opted out in Settings — and enabled, not crashing,
 * when storage is denied: this is read while rendering Settings and again on
 * every capture, so throwing here took out the page and the reporter both.
 */
export function isErrorReportingEnabled(): boolean {
  return readSetting(STORAGE_KEY) !== "false";
}

export function setErrorReportingEnabled(enabled: boolean): void {
  writeSetting(STORAGE_KEY, String(enabled));
}

/**
 * App-wide reporter. Reports are sanitized by core (allowlisted context only)
 * and go to the browser console — nothing leaves the device. The opt-out is
 * re-checked on every capture so the Settings toggle applies immediately.
 */
export const errorReporter: ErrorReporter = createErrorReporter({ isEnabled: isErrorReportingEnabled });

let globalHandlersRegistered = false;

/** Captures errors that escape React entirely. Idempotent (StrictMode/HMR safe). */
export function registerGlobalErrorHandlers(): void {
  if (globalHandlersRegistered) return;
  globalHandlersRegistered = true;
  window.addEventListener("error", (event) => {
    errorReporter.capture(toReportableError(event.error), { source: "window" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    errorReporter.capture(toReportableError(event.reason), { source: "unhandledrejection" });
  });
}

/**
 * Hooked into TanStack Router's defaultOnCatch — route render errors never bubble
 * past the router. The value is whatever the render threw, not necessarily an
 * Error, so it goes through `toReportableError` like the window handlers above.
 *
 * `errorInfo` is the router's own catch boundary's React `ErrorInfo`, and its
 * `componentStack` is the only thing that says which component threw — without
 * it a route crash reports the same as any other. Optional because tests call
 * this directly; an absent stack leaves the key off the report rather than
 * writing `undefined` (core drops non-primitive context values).
 */
export function onRouterCatch(error: unknown, errorInfo?: ErrorInfo): void {
  errorReporter.capture(toReportableError(error), {
    source: "router",
    componentStack: errorInfo?.componentStack ?? undefined,
  });
}

/**
 * Hooked into the React Query caches: rejected queries/mutations never reach
 * window handlers, so this is the only place API failures get reported.
 * 401s are excluded — auth recovery handles those as a normal flow.
 */
export function reportQueryError(error: unknown): void {
  if (error instanceof UnauthorizedError) return;
  errorReporter.capture(toReportableError(error), { source: "query" });
}
