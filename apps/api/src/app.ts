import fastifyBearerAuth from "@fastify/bearer-auth";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifySensible from "@fastify/sensible";
import { createErrorReporter, type ErrorReporter, toReportableError } from "@mycollections/core";
import type { DatabaseHandle } from "@mycollections/db";
import Fastify from "fastify";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerItemRoutes } from "./routes/items.js";

export interface AppOptions {
  db: DatabaseHandle;
  /** Bearer token required on every route except /api/health (and /api/docs in dev). */
  token: string;
  /** Enable Swagger UI at /api/docs and relax CSP. Only use in development. */
  isDev?: boolean;
  logger?: boolean | object;
  /** Receives unhandled (5xx) errors. Defaults to a reporter that writes sanitized reports to the app log. */
  errorReporter?: ErrorReporter;
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

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isDev ? false : undefined,
  });

  await app.register(fastifyCors, {
    origin: isDev ? /^http:\/\/localhost(:\d+)?$/ : false,
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
  });

  return app;
}
