import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateDeviceToken, resolveDeviceToken } from "./device-token.js";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
// 43 characters from the base64url alphabet, spelled in words cSpell accepts.
const VALID = "correct-horse-battery-staple-fixture-tokens";

let dir: string;
let tokenPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "device-token-"));
  tokenPath = join(dir, "api-token");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function plant(contents: string, mode = 0o600): void {
  writeFileSync(tokenPath, contents, { mode });
  chmodSync(tokenPath, mode);
}

describe("loadOrCreateDeviceToken", () => {
  it("creates a 256-bit base64url token in a file only the owner can read", () => {
    const result = loadOrCreateDeviceToken(tokenPath);
    expect(result.created).toBe(true);
    expect(result.token).toMatch(TOKEN_SHAPE);
    expect(readFileSync(tokenPath, "utf8")).toBe(result.token);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
  });

  it("returns the same token on the next start, which is the whole point (#241)", () => {
    const first = loadOrCreateDeviceToken(tokenPath);
    const second = loadOrCreateDeviceToken(tokenPath);
    expect(second).toEqual({ token: first.token, created: false });
  });

  it("leaves no temporary file behind after creating the token", () => {
    loadOrCreateDeviceToken(tokenPath);
    expect(readdirSync(dir)).toEqual(["api-token"]);
  });

  it("reads a token whose file gained a trailing newline from a hand edit", () => {
    plant(`${VALID}\n`);
    expect(loadOrCreateDeviceToken(tokenPath)).toEqual({ token: VALID, created: false });
  });

  it("refuses a token file that group or others can read, since the token may already have leaked", () => {
    plant(VALID, 0o644);
    expect(() => loadOrCreateDeviceToken(tokenPath)).toThrow(/readable by other users.*chmod 600/);
  });

  it("refuses a symlink, so a link planted in a shared directory cannot point the server at a token someone else chose", () => {
    const target = join(dir, "elsewhere");
    writeFileSync(target, VALID, { mode: 0o600 });
    symlinkSync(target, tokenPath);
    expect(() => loadOrCreateDeviceToken(tokenPath)).toThrow(/not a regular file/);
  });

  it("refuses a directory in the token's place", () => {
    mkdirSync(tokenPath);
    expect(() => loadOrCreateDeviceToken(tokenPath)).toThrow(/not a regular file/);
  });

  it("refuses a file owned by another user, which is what a token planted in /tmp looks like", () => {
    plant(VALID);
    const otherUid = (process.getuid?.() ?? 0) + 1;
    expect(() => loadOrCreateDeviceToken(tokenPath, { expectedUid: otherUid })).toThrow(/owned by another user/);
  });

  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["outside the alphabet", `${VALID.slice(0, 42)}!`],
    ["two tokens", `${VALID}\n${VALID}`],
  ])("refuses a malformed token file (%s) rather than guess", (_label, contents) => {
    plant(contents);
    expect(() => loadOrCreateDeviceToken(tokenPath)).toThrow(/not a valid device token/);
  });

  it("never puts the token itself in an error message", () => {
    plant(VALID, 0o640);
    let message = "";
    try {
      loadOrCreateDeviceToken(tokenPath);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/readable by other users/);
    expect(message).not.toContain(VALID);
  });
});

describe("resolveDeviceToken", () => {
  it("uses an explicit API_TOKEN and never touches the file", () => {
    const dbPath = join(dir, "app.db");
    expect(resolveDeviceToken({ token: "explicit-token", dbPath })).toEqual({
      token: "explicit-token",
      source: "env",
      created: false,
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps the token beside the database, so each DB_PATH (a second worktree) has its own", () => {
    const dbPath = join(dir, "app.db");
    const result = resolveDeviceToken({ token: undefined, dbPath });
    expect(result).toMatchObject({ source: "file", path: tokenPath, created: true });
    expect(result.token).toBe(readFileSync(tokenPath, "utf8"));
  });

  it("generates a per-run token for an in-memory database, which has no folder to keep one in", () => {
    const first = resolveDeviceToken({ token: undefined, dbPath: ":memory:" });
    const second = resolveDeviceToken({ token: undefined, dbPath: ":memory:" });
    expect(first).toMatchObject({ source: "ephemeral", created: false });
    expect(first.token).toMatch(TOKEN_SHAPE);
    expect(second.token).not.toBe(first.token);
  });
});
