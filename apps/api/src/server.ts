import { randomUUID } from "node:crypto";
import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";

const DB_PATH = process.env.DB_PATH ?? "data/app.db";
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const IS_DEV = process.env.NODE_ENV !== "production";

const token = process.env.API_TOKEN ?? randomUUID();

const handle = await openDatabase({ path: DB_PATH });
const app = await buildApp({ db: handle, token, isDev: IS_DEV, logger: true });

await app.listen({ port: PORT, host: HOST });

if (IS_DEV) {
  console.log(`API token: ${token}`);
  console.log(`Swagger UI: http://${HOST}:${PORT}/api/docs`);
}
