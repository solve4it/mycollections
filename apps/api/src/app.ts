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
  /** Bearer token required on all routes except /api/health and /api/docs. */
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

  app.addHook("onRequest", async (request, reply) => {
    const url = request.url;
    if (url === "/api/health" || url.startsWith("/api/docs")) return;
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (auth.slice(7) !== token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await registerCollectionRoutes(app, db);
  await registerItemRoutes(app, db);
  await registerExportRoutes(app, db);

  return app;
}
