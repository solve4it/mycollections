const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export interface LoggerOptions {
  level: string;
  redact: { paths: string[]; censor: string };
}

/**
 * Builds pino options for Fastify's built-in logger. Requests are logged
 * automatically by Fastify; the default `req` serializer only includes
 * method/url/host/remoteAddress, and credential-bearing headers are redacted
 * as defense-in-depth in case a custom serializer ever logs headers.
 * Never log request bodies — they contain collection data.
 */
export function buildLoggerOptions(options: { isDev?: boolean; level?: string } = {}): LoggerOptions {
  const fallback = options.isDev ? "debug" : "info";
  const level = PINO_LEVELS.includes(options.level as (typeof PINO_LEVELS)[number])
    ? (options.level as string)
    : fallback;
  return {
    level,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[REDACTED]",
    },
  };
}
