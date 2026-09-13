import fastifyBearerAuth from "@fastify/bearer-auth";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifySensible from "@fastify/sensible";
import { createErrorReporter, type ErrorReporter, toReportableError } from "@mycollections/core";
import type { DatabaseHandle } from "@mycollections/db";
import Fastify from "fastify";
import { DEFAULT_DEV_ORIGINS, isLoopbackHost, normalizeDevOrigins } from "./config.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerTrashRoutes } from "./routes/trash.js";

export interface AppOptions {
  db: DatabaseHandle;
  /** Bearer token required on every route except /api/health (and /api/docs in dev). */
  token: string;
  /** Enable Swagger UI at /api/docs and relax CSP. Only use in development. */
  isDev?: boolean;
  logger?: boolean | object;
  /** Receives unhandled (5xx) errors. Defaults to a reporter that writes sanitized reports to the app log. */
  errorReporter?: ErrorReporter;
  /**
   * Extra hostnames accepted in the Host header, on top of loopback. `false` disables
   * the check, which is what a deliberate non-loopback bind needs — there is no way to
   * know which name a LAN client will use. See `resolveServerConfig`.
   */
  allowedHosts?: string[] | false;
  /**
   * Browser origins accepted in development, defaulting to `DEFAULT_DEV_ORIGINS`.
   * Every entry must be a loopback origin — `normalizeDevOrigins` rejects anything
   * else, so no caller can widen this into a wildcard. Ignored entirely unless
   * `isDev`: outside development the API answers no CORS request at all.
   */
  devOrigins?: readonly string[];
}

/** Strips the port, brackets, casing and any trailing dot from a Host header value. */
function hostnameFrom(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return (trimmed.split(":")[0] ?? "").replace(/\.$/, "");
}

/**
 * Defense against DNS rebinding: a page on an attacker's domain whose name resolves to
 * 127.0.0.1 reaches this server as a same-origin request, so CORS never sees it. The
 * Host header still carries the attacker's name.
 *
 * Reads `request.headers.host` rather than `request.hostname`, which Fastify derives
 * from `X-Forwarded-Host` when `trustProxy` is on, which the client can forge.
 */
/**
 * The development allowlist, re-validated here as well as at startup so a programmatic
 * caller cannot hand `buildApp` something @fastify/cors would read as "allow anything":
 * a single `"*"` in the array collapses the whole option to the wildcard string, which
 * also drops `Vary: Origin`. `normalizeDevOrigins` rejects it — `new URL("*")` throws.
 *
 * An empty list is refused rather than accepted: `origin: []` is truthy, so the plugin
 * takes it as a valid allowlist that matches nothing, and every call fails with no
 * error anywhere — the silent breakage #327 is about, inverted.
 */
function devCorsOrigins(devOrigins: readonly string[] | undefined): string[] {
  const origins = normalizeDevOrigins(devOrigins ?? DEFAULT_DEV_ORIGINS);
  if (origins.length === 0) {
    throw new Error(
      "no dev origin is allowed: the development CORS allowlist is empty, so every browser call would fail silently.",
    );
  }
  return origins;
}

function isAllowedHost(header: string | undefined, extraHosts: string[]): boolean {
  if (header === undefined) {
    // HTTP/1.1 requires a Host header. There is nothing to validate, so refuse.
    return false;
  }
  const hostname = hostnameFrom(header);
  return isLoopbackHost(hostname) || extraHosts.some((allowed) => hostnameFrom(allowed) === hostname);
}

export async function buildApp(options: AppOptions) {
  const { db, token, isDev = false } = options;

  const app = Fastify({ logger: options.logger ?? false });

  const errorReporter =
    options.errorReporter ??
    createErrorReporter({ sink: (report) => app.log.error({ errorReport: report }, "error captured") });

  app.setErrorHandler((error: unknown, request, reply) => {
    const rawStatus = (error as { statusCode?: unknown }).statusCode;
    const statusCode = typeof rawStatus === "number" && rawStatus >= 400 ? rawStatus : 500;
    if (statusCode < 500) {
      // Client errors (validation, 404, …) keep Fastify's default shape and message.
      return reply.code(statusCode).send(error);
    }
    request.log.error({ err: error }, "unhandled error");
    errorReporter.capture(toReportableError(error), {
      method: request.method,
      // routeOptions.url is undefined for unmatched routes; the reporter drops non-primitives.
      route: request.routeOptions.url,
      statusCode,
      reqId: request.id,
    });
    // Never echo internal error details to the client.
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  // Registered before CORS so it also covers preflight requests, which @fastify/cors answers
  // from its own onRequest hook, and before every route including /api/health.
  if (options.allowedHosts !== false) {
    const extraHosts = options.allowedHosts ?? [];
    app.addHook("onRequest", async (request, reply) => {
      if (!isAllowedHost(request.headers.host, extraHosts)) {
        return reply.code(403).send({ error: "Forbidden" });
      }
    });
  }

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isDev ? false : undefined,
  });

  await app.register(fastifyCors, {
    // The ternary is the whole production guarantee: outside development `origin` is
    // `false`, so no allowlist — configured, defaulted or malformed — is ever consulted
    // and no `Access-Control-Allow-Origin` is ever sent. Inside development the list is
    // re-validated here as well as at startup, so a programmatic caller cannot hand
    // `buildApp` a wildcard or a remote origin (#327).
    origin: isDev ? devCorsOrigins(options.devOrigins) : false,
    credentials: true,
    // @fastify/cors defaults Access-Control-Allow-Methods to only GET, HEAD and
    // POST, which makes browsers block our PATCH/DELETE routes in preflight.
    // Advertise every method the API exposes.
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(fastifySensible);

  if (isDev) {
    const { default: fastifySwagger } = await import("@fastify/swagger");
    const { default: fastifySwaggerUi } = await import("@fastify/swagger-ui");
    await app.register(fastifySwagger, {
      openapi: {
        info: { title: "MyCollections API", version: "0.1.0" },
      },
    });
    await app.register(fastifySwaggerUi, {
      routePrefix: "/api/docs",
      uiConfig: { docExpansion: "list" },
    });
  }

  // Public surface: registered on the root instance, outside the authenticated scope
  // below. Swagger (registered above, dev only) is public for the same reason.
  app.get("/api/health", async () => ({ status: "ok" }));

  // Everything else lives inside an encapsulated scope that registers the bearer
  // guard, so a route is protected by where it is registered rather than by its path
  // matching an exemption list. The previous hook compared `request.url` against
  // "/api/health" and a "/api/docs" prefix, which meant a query string turned the
  // health route into a 401, "/api/docs-private" was exempt, and the docs exemption
  // applied in production too — where Swagger is never registered (#242).
  await app.register(async (authenticated) => {
    await authenticated.register(fastifyBearerAuth, {
      keys: new Set([token]),
      // The plugin compares with timingSafeEqual, and on a length mismatch compares a
      // buffer against itself rather than returning early, so neither the token nor
      // its length leaks through response timing.
      //
      // "rfc6749" is the plugin's name for matching the auth scheme case-insensitively,
      // which is what RFC 7235 §2.1 requires of every scheme name; its default mode
      // accepts the literal "Bearer " only.
      specCompliance: "rfc6749",
      // Keep the response body identical for a missing and an invalid header, so it
      // says nothing about why the request failed.
      errorResponse: () => ({ error: "Unauthorized" }),
    });

    await registerCollectionRoutes(authenticated, db);
    await registerItemRoutes(authenticated, db);
    await registerExportRoutes(authenticated, db);
    await registerTrashRoutes(authenticated, db);
  });

  return app;
}
