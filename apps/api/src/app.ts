import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifySensible from "@fastify/sensible";
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
}

export async function buildApp(options: AppOptions) {
  const { db, token, isDev = false } = options;

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: isDev ? false : undefined,
  });

  await app.register(fastifyCors, {
    origin: isDev ? /^http:\/\/localhost(:\d+)?$/ : false,
    credentials: true,
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
