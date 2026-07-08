import type { ErrorReporter } from "./providers.js";

// This package targets no runtime (lib: ES2022 only); console exists in both
// browsers and Node, so declare the one member the default sink needs.
declare const console: { error: (...data: unknown[]) => void };

/**
 * Context keys allowed into an {@link ErrorReport}. Everything else is dropped
 * so collection data, request bodies, tokens, and other PII can never leak
 * into a report regardless of what callers pass.
 */
export const SAFE_CONTEXT_KEYS = ["route", "method", "statusCode", "componentStack", "source", "reqId"] as const;

export type SafeContextKey = (typeof SAFE_CONTEXT_KEYS)[number];

/**
 * A sanitized error report ready for a sink.
 *
 * PRIVACY: `context` is allowlisted, but `message` and `stack` pass through
 * from the error (truncated) and MAY contain user data — e.g. validation
 * messages echoing field values. Any future sink that transmits reports off
 * the device must scrub these fields first; today's sinks are local-only.
 */
export interface ErrorReport {
  name: string;
  message: string;
  stack?: string;
  context: Partial<Record<SafeContextKey, string | number | boolean>>;
}

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 4_000;

/**
 * Builds a privacy-safe report from an error: only the error's own
 * name/message/stack (length-capped) plus allowlisted primitive context
 * values survive.
 */
export function buildErrorReport(error: Error, context?: Record<string, unknown>): ErrorReport {
  const safeContext: ErrorReport["context"] = {};
  if (context) {
    for (const key of SAFE_CONTEXT_KEYS) {
      const value = context[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        safeContext[key] = value;
      }
    }
  }
  return {
    name: error.name,
    message: error.message.slice(0, MAX_MESSAGE_LENGTH),
    stack: error.stack?.slice(0, MAX_STACK_LENGTH),
    context: safeContext,
  };
}

/**
 * Converts an unknown thrown value (e.g. `unhandledrejection.reason`) into an
 * Error safe to report. Non-Error values are NOT stringified — an object
 * reason could embed collection data — only their constructor name survives.
 */
export function toReportableError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const typeName =
    reason === null ? "null" : typeof reason === "object" ? (reason.constructor?.name ?? "object") : typeof reason;
  return new Error(`Non-Error thrown value of type ${typeName}`);
}

export interface CreateErrorReporterOptions {
  /** Checked on every capture; when it returns false the error is silently dropped (user opt-out). */
  isEnabled?: () => boolean;
  /** Receives sanitized reports. Defaults to console.error. */
  sink?: (report: ErrorReport) => void;
}

/**
 * Creates an {@link ErrorReporter} that sanitizes every capture via
 * {@link buildErrorReport} before handing it to the sink. Capture never
 * throws: a broken sink must not take the app down with it.
 */
export function createErrorReporter(options: CreateErrorReporterOptions = {}): ErrorReporter {
  const { isEnabled, sink = (report) => console.error("[error-report]", report) } = options;
  return {
    capture(error, context) {
      try {
        if (isEnabled && !isEnabled()) return;
        sink(buildErrorReport(error, context));
      } catch {
        // Swallow sink failures — error reporting is best-effort by design.
      }
    },
  };
}
