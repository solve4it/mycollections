import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";
import { resolveServerConfig, type ServerConfig, startupWarnings } from "./config.js";
import { type DeviceToken, resolveDeviceToken } from "./device-token.js";
import { buildLoggerOptions } from "./logger.js";
import { MediaStore } from "./media/media-store.js";
import { isPairingEnabled, PairingCodes, pairingLink } from "./pairing.js";

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

// After `openDatabase`, which creates the database's directory at 0700 — the token file
// lives in it. A token file that fails its ownership or permission checks is the
// operator's to fix, like any other misconfiguration (#241).
let deviceToken: DeviceToken;
try {
  deviceToken = resolveDeviceToken({ token: config.token, dbPath: config.dbPath });
} catch (error) {
  exitWithConfigurationError(error);
}

// An in-memory database (the e2e suite) has no folder to keep images beside, and
// nothing it stores outlives the process, so neither do its images.
const mediaDir = config.mediaDir ?? (await mkdtemp(join(tmpdir(), "mycollections-media-")));
const media = await MediaStore.open(mediaDir).catch(exitWithConfigurationError);
// Files no row names any more: a crash between a purge's commit and its unlink, a
// database restored from a backup older than its images. Nothing is in flight yet.
const swept = await media.sweep(await handle.media.listFileRefs());
// One-time pairing links (#241), in development on loopback only. After a browser
// pairs, the next link is printed straight away so a second browser can pair too.
const pairingCodes = isPairingEnabled(config) ? new PairingCodes() : undefined;
const webOrigin = config.devOrigins[0];
function announcePairingLink(codes: PairingCodes): void {
  if (webOrigin === undefined) return;
  console.log(`Pair a browser (link valid 15 minutes): ${pairingLink(webOrigin, codes.mint())}`);
}

// `buildApp` validates too — it refuses a dev CORS allowlist that is empty or not
// loopback — and a throw here is a misconfiguration like any other, not a crash.
const app = await buildApp({
  db: handle,
  token: deviceToken.token,
  isDev: config.isDev,
  allowedHosts: config.allowedHosts,
  devOrigins: config.devOrigins,
  media: { store: media },
  pairing: pairingCodes && { codes: pairingCodes, onPaired: () => announcePairingLink(pairingCodes) },
  logger: buildLoggerOptions({ isDev: config.isDev, level: process.env.LOG_LEVEL }),
}).catch(exitWithConfigurationError);

await app.listen({ port: config.port, host: config.host });

console.log(`Database: ${config.dbPath}`);
console.log(`Media: ${mediaDir}`);
if (swept > 0) console.log(`Removed ${swept} image file(s) no longer referenced by the database.`);
for (const warning of startupWarnings(config)) {
  console.warn(`WARNING: ${warning}`);
}
if (config.isDev) {
  console.log(describeToken(deviceToken));
  console.log(`Swagger UI: http://${config.host}:${config.port}/api/docs`);
}
if (pairingCodes) announcePairingLink(pairingCodes);

/**
 * Where the token is, never what it is — except for an in-memory database's per-run
 * token, which has nowhere else to be found and dies with the process. The persisted
 * token is long-lived, so printing it would leave it in every terminal, `turbo` log and
 * CI transcript that ever captured a startup (#241).
 */
function describeToken(resolved: DeviceToken): string {
  switch (resolved.source) {
    case "env":
      return "API token: from API_TOKEN";
    case "file":
      return `API token: ${resolved.created ? "created and " : ""}stored in ${resolved.path}`;
    case "ephemeral":
      return `API token (this run only): ${resolved.token}`;
  }
}
