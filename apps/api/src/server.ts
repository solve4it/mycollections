import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";
import { resolveServerConfig, type ServerConfig, startupWarnings } from "./config.js";
import { buildLoggerOptions } from "./logger.js";

function loadConfig(): ServerConfig {
  try {
    return resolveServerConfig();
  } catch (error) {
    // A misconfiguration is the operator's to fix, so print the message rather than
    // a stack trace — and refuse to start rather than bind something unintended.
    console.error(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const config = loadConfig();

const handle = await openDatabase({ path: config.dbPath });
const app = await buildApp({
  db: handle,
  token: config.token,
  isDev: config.isDev,
  allowedHosts: config.allowedHosts,
  logger: buildLoggerOptions({ isDev: config.isDev, level: process.env.LOG_LEVEL }),
});

await app.listen({ port: config.port, host: config.host });

console.log(`Database: ${config.dbPath}`);
for (const warning of startupWarnings(config)) {
  console.warn(`WARNING: ${warning}`);
}
if (config.isDev) {
  console.log(`API token: ${config.token}`);
  console.log(`Swagger UI: http://${config.host}:${config.port}/api/docs`);
}
