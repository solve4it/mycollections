import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase } from "@mycollections/db";
import { buildApp } from "./app.js";
import { resolveServerConfig, type ServerConfig, startupWarnings } from "./config.js";
import { type DeviceToken, resolveDeviceToken } from "./device-token.js";
import { buildLoggerOptions } from "./logger.js";
import { MediaStore } from "./media/media-store.js";
import {
  openerCommand,
  removeStaleRedirectFiles,
  shouldAutoOpen,
  waitForOrigin,
  writeRedirectFile,
} from "./open-browser.js";
import { isPairingEnabled, PAIRING_TTL_MS, PairingCodes, pairingLink } from "./pairing.js";

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
function announcePairingLink(codes: PairingCodes): string | undefined {
  if (webOrigin === undefined) return undefined;
  const link = pairingLink(webOrigin, codes.mint());
  console.log(`Pair a browser (link valid 15 minutes): ${link}`);
  return link;
}

// The first-run redirect page holds a live code, so it goes as soon as the code does:
// on pairing, at expiry, or — for a run that was killed — at the next start.
const dataDir = config.dbPath === ":memory:" ? undefined : dirname(config.dbPath);
let redirectFile: string | undefined;
function removeRedirectFile(): void {
  if (redirectFile !== undefined) rmSync(redirectFile, { force: true });
  redirectFile = undefined;
}
if (pairingCodes && dataDir !== undefined) removeStaleRedirectFiles(dataDir);

/**
 * Opens the pairing link on a first run (#241) once the web app answers. Never fatal: a
 * missing opener or a web server that never comes up leaves the printed link to use.
 */
async function openPairingLink(origin: string, directory: string, link: string): Promise<void> {
  if (!(await waitForOrigin(origin))) {
    console.log(`The web app did not answer at ${origin}; open the pairing link above once it is running.`);
    return;
  }
  redirectFile = writeRedirectFile(directory, link);
  setTimeout(removeRedirectFile, PAIRING_TTL_MS).unref();
  const { command, args } = openerCommand(process.platform, redirectFile);
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log("Could not open a browser; open the pairing link above."));
  child.unref();
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
  pairing: pairingCodes && {
    codes: pairingCodes,
    onPaired: () => {
      removeRedirectFile();
      announcePairingLink(pairingCodes);
    },
  },
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
if (pairingCodes) {
  const link = announcePairingLink(pairingCodes);
  const autoOpen = shouldAutoOpen({ created: deviceToken.created, pairingEnabled: true, env: process.env });
  if (link !== undefined && autoOpen && webOrigin !== undefined && dataDir !== undefined) {
    void openPairingLink(webOrigin, dataDir, link);
  }
}

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
