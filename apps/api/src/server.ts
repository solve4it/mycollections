import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";
import { buildLoggerOptions } from "./logger.js";

// Default to a fixed location anchored to the app directory (apps/api/data/app.db),
// resolved from this module's URL so it's the SAME file regardless of the working
// directory the server is launched from. A cwd-relative default would silently put
// the database in different places, making collections appear to vanish. DB_PATH overrides.
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL("../data/app.db", import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const IS_DEV = process.env.NODE_ENV !== "production";

const token = process.env.API_TOKEN ?? randomUUID();

const handle = await openDatabase({ path: DB_PATH });
const app = await buildApp({
  db: handle,
  token,
  isDev: IS_DEV,
  logger: buildLoggerOptions({ isDev: IS_DEV, level: process.env.LOG_LEVEL }),
});

await app.listen({ port: PORT, host: HOST });

console.log(`Database: ${DB_PATH}`);
if (IS_DEV) {
  console.log(`API token: ${token}`);
  console.log(`Swagger UI: http://${HOST}:${PORT}/api/docs`);
}
