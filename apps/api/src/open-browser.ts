import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync, readdirSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * Opening the pairing link for the user on a first run (#241), so a fresh install reaches
 * a working app without anyone reading the terminal.
 *
 * The platform's own opener is spawned with an argument array — no shell, no extra
 * dependency. What it is handed is a 0600 redirect page in the data directory, never the
 * link itself: a browser launched cold keeps its URL arguments in its process's argv,
 * where `ps` shows them to every user on the machine. Jupyter's `jpserver-*-open.html`
 * exists for exactly that reason.
 */

export interface AutoOpenInput {
  /** True only on the start that created the token file: a fresh install, or the first start after upgrading. */
  created: boolean;
  pairingEnabled: boolean;
  env: NodeJS.ProcessEnv;
}

export function shouldAutoOpen({ created, pairingEnabled, env }: AutoOpenInput): boolean {
  if (!created || !pairingEnabled) return false;
  if (isTruthy(env.CI)) return false;
  // `BROWSER=none` is the opt-out create-react-app established and `xdg-open`-style tools
  // read; reusing it means nobody learns a new variable to stop a browser opening.
  if (env.BROWSER?.trim().toLowerCase() === "none") return false;
  return true;
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && normalized !== "" && normalized !== "false" && normalized !== "0";
}

export function openerCommand(platform: NodeJS.Platform, target: string): { command: string; args: string[] } {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [target] };
    case "win32":
      // explorer.exe opens a path with its default handler and, unlike `start`, is a
      // real executable rather than a cmd.exe builtin, so no shell is involved.
      return { command: "explorer.exe", args: [target] };
    default:
      return { command: "xdg-open", args: [target] };
  }
}

/**
 * Writes the redirect page: `pair-<random>.html` in `dir` (the data directory, already
 * 0700), created exclusively at 0600 so no other user can read the code inside it.
 */
export function writeRedirectFile(dir: string, link: string): string {
  const path = join(dir, `pair-${randomBytes(8).toString("hex")}.html`);
  const href = escapeHtml(link);
  const html =
    '<!doctype html>\n<meta charset="utf-8">\n<title>MyCollections</title>\n' +
    `<meta http-equiv="refresh" content="0;url=${href}">\n` +
    `<p><a href="${href}">Continue to MyCollections</a></p>\n`;
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeSync(fd, html);
  } finally {
    closeSync(fd);
  }
  return path;
}

const REDIRECT_FILE = /^pair-[0-9a-f]{16}\.html$/;

/**
 * Removes redirect pages an earlier run left behind — one killed before its pairing
 * finished or its code expired. Their codes died with that process, so they are only
 * clutter, but clutter holding what looks like a credential.
 */
export function removeStaleRedirectFiles(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (REDIRECT_FILE.test(name)) rmSync(join(dir, name), { force: true });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

export interface WaitOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls until the web origin answers anything at all. Under `pnpm dev` turbo starts the
 * API and Vite together and either can win, so opening the link straight away could
 * land the user on a connection error with the code already spent from view.
 */
export async function waitForOrigin(origin: string, options: WaitOptions = {}): Promise<boolean> {
  const {
    fetch: doFetch = globalThis.fetch,
    timeoutMs = 60_000,
    intervalMs = 500,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      await doFetch(origin, { method: "HEAD", signal: AbortSignal.timeout(intervalMs * 4) });
      return true;
    } catch {
      // Not listening yet.
    }
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
