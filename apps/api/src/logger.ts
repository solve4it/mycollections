const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/** The parts of a Fastify request the `req` serializer reads. */
export interface SerializableRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

export interface LoggerOptions {
  level: string;
  redact: { paths: string[]; censor: string };
  serializers: { req: (request: SerializableRequest) => Record<string, unknown> };
}

/** A request url without its query string — the only form of a url that may be logged. */
export function pathOf(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Fastify's default `req` serializer with the query string cut off the url.
 * Search text (`?q=`) and sort keys naming fields are collection data, held to
 * the same rule as request bodies (#41).
 */
function serializeRequest(request: SerializableRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: pathOf(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

/**
 * Builds pino options for Fastify's built-in logger. Requests are logged
 * automatically by Fastify; the default `req` serializer only includes
 * method/url/host/remoteAddress, and credential-bearing headers are redacted
 * as defense-in-depth in case a custom serializer ever logs headers.
 * Never log request bodies or query strings — they contain collection data.
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
    serializers: { req: serializeRequest },
  };
}
