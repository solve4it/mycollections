import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";
import { resolveServerConfig, type ServerConfig, startupWarnings } from "./config.js";
import { buildLoggerOptions } from "./logger.js";

/**
 * A misconfiguration is the operator's to fix, so print the message rather than a stack
 * trace — and refuse to start rather than bind something unintended.
 */
function exitWithConfigurationError(error: unknown): never {
  console.error(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function loadConfig(): ServerConfig {
  try {
    return resolveServerConfig();
  } catch (error) {
    return exitWithConfigurationError(error);
  }
}

const config = loadConfig();

const handle = await openDatabase({ path: config.dbPath });
// `buildApp` validates too — it refuses a dev CORS allowlist that is empty or not
// loopback — and a throw here is a misconfiguration like any other, not a crash.
const app = await buildApp({
  db: handle,
  token: config.token,
  isDev: config.isDev,
  allowedHosts: config.allowedHosts,
  devOrigins: config.devOrigins,
  logger: buildLoggerOptions({ isDev: config.isDev, level: process.env.LOG_LEVEL }),
}).catch(exitWithConfigurationError);

await app.listen({ port: config.port, host: config.host });

console.log(`Database: ${config.dbPath}`);
for (const warning of startupWarnings(config)) {
  console.warn(`WARNING: ${warning}`);
}
if (config.isDev) {
  console.log(`API token: ${config.token}`);
  console.log(`Swagger UI: http://${config.host}:${config.port}/api/docs`);
}
