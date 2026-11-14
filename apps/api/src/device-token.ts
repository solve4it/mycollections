import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The API's bearer token, kept so it survives a restart (#241).
 *
 * Before this, an unset `API_TOKEN` meant a fresh `randomUUID()` on every start, so
 * every restart signed every browser out and sent the user back to the terminal to
 * copy a new one (#185). The token now lives in a file beside the database, which is
 * the same pattern Bitcoin Core's `.cookie`, Tor's cookie authentication and
 * Jupyter's runtime files use: a local client proves itself by being able to read a
 * file only the server's user can read.
 *
 * Kept behind this module rather than in `resolveServerConfig`, which stays pure:
 * reading and creating files belongs to the entrypoint. The OS keychain (#169) can
 * replace the file behind the same `resolveDeviceToken` seam.
 */

/** File name of the token, inside the database's (already 0700) directory. */
export const TOKEN_FILE_NAME = "api-token";

const FILE_MODE = 0o600;
/** 32 random bytes in base64url: 43 characters, 256 bits. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type DeviceTokenSource = "env" | "file" | "ephemeral";

export interface DeviceToken {
  token: string;
  source: DeviceTokenSource;
  /** The token file, when `source` is `"file"`. */
  path?: string;
  /** True only on the start that created the token file — a first run, or the first run after upgrading. */
  created: boolean;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Where this start's token comes from, in order: an explicit `API_TOKEN`, then the
 * token file beside a database on disk, then — for an in-memory database, which has
 * no folder to keep a file in and whose data dies with the process anyway — a token
 * generated for this run only.
 *
 * Call it after `openDatabase`, which creates the database's directory at 0700.
 */
export function resolveDeviceToken(config: { token: string | undefined; dbPath: string }): DeviceToken {
  if (config.token !== undefined) {
    return { token: config.token, source: "env", created: false };
  }
  if (config.dbPath === ":memory:") {
    return { token: generateToken(), source: "ephemeral", created: false };
  }
  const path = join(dirname(config.dbPath), TOKEN_FILE_NAME);
  return { ...loadOrCreateDeviceToken(path), source: "file", path };
}

export interface LoadOptions {
  /**
   * The uid the file must belong to. Defaults to this process's; undefined where the
   * platform has no user ids (Windows), which skips the check. Injectable for the test,
   * since a test cannot create a file owned by somebody else.
   */
  expectedUid?: number;
}

/**
 * Reads the token file, creating it first if there is none.
 *
 * Every check on read exists because the file decides who may drive the API. With
 * `DB_PATH=/tmp/app.db` the token would live in `/tmp`, where any local user can
 * create `/tmp/api-token` holding a token they know — so the server refuses a file
 * that is a symlink, is not a regular file, belongs to another user, or is readable
 * by group or others (in which case it may already have leaked), the same stance as
 * OpenSSH's `StrictModes`. Refusing is a configuration error naming the fix; the
 * error never contains the token.
 */
export function loadOrCreateDeviceToken(
  path: string,
  options: LoadOptions = { expectedUid: process.getuid?.() },
): { token: string; created: boolean } {
  const token = generateToken();
  if (createExclusively(path, token)) {
    return { token, created: true };
  }
  return { token: readExisting(path, options.expectedUid), created: false };
}

/**
 * Writes the token to a private temporary file and hard-links it into place. `link`
 * fails if the name exists, so creation is atomic and complete: no reader can ever see
 * a half-written token, and two starts racing on one database agree on whichever
 * token landed first. Returns false when a token file (or anything else) is already
 * at `path`.
 */
function createExclusively(path: string, token: string): boolean {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
  try {
    writeSync(fd, token);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}

function readExisting(path: string, expectedUid: number | undefined): string {
  let fd: number;
  try {
    // O_NOFOLLOW refuses a symlink at the last path component (ELOOP) rather than
    // following it; it is 0, and so a no-op, where the platform lacks it.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EISDIR") throw notRegular(path);
    throw error;
  }
  try {
    // fstat on the descriptor, not stat on the name, so nothing can be swapped in
    // between the check and the read.
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw notRegular(path);
    if (expectedUid !== undefined && stat.uid !== expectedUid) {
      throw new Error(
        `the device token file ${path} is owned by another user. Delete it and restart to generate a new one, ` +
          "or point DB_PATH at a directory only you can write to.",
      );
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(
        `the device token file ${path} is readable by other users, so the token may have leaked. ` +
          `Delete it and restart to generate a new one, or run chmod 600 on it if you are sure it has not.`,
      );
    }
    const contents = readFileSync(fd, "utf8").replace(/\r?\n$/, "");
    if (!TOKEN_SHAPE.test(contents)) {
      throw new Error(
        `the device token file ${path} is not a valid device token. Delete it and restart to generate a new one.`,
      );
    }
    return contents;
  } finally {
    closeSync(fd);
  }
}

function notRegular(path: string): Error {
  return new Error(`the device token file ${path} is not a regular file. Remove it and restart to generate a new one.`);
}
