import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Minimum length for a token that guards a network-reachable bind. Long enough to
 * rule out the memorable placeholders our own docs suggest for loopback work; a
 * generated UUID (36 chars) clears it.
 */
const MIN_NETWORK_TOKEN_LENGTH = 32;

export interface ServerConfig {
  dbPath: string;
  port: number;
  host: string;
  token: string;
  isDev: boolean;
  /**
   * Passed straight to `buildApp`. `undefined` keeps the default loopback-only Host
   * allowlist; `false` disables Host pinning, which is what a deliberate non-loopback
   * bind needs — see `resolveServerConfig`.
   */
  allowedHosts?: string[] | false;
  /**
   * Browser origins the API accepts in development, already validated and normalized.
   * Empty outside development, where CORS is off entirely — `buildApp` ignores this
   * unless `isDev`.
   */
  devOrigins: string[];
}

/**
 * Browser origins allowed to call the API in development. The web app is served by
 * Vite (5173 `dev`, 4173 `preview`) on a different origin from the API, so this is
 * load-bearing rather than decorative — there is no dev proxy.
 *
 * This replaced `/^http:\/\/localhost(:\d+)?$/`, which trusted every port on
 * localhost. Any local process can bind a high port, and with `credentials: true`
 * that becomes a CSRF hole the moment a cookie session replaces the bearer header.
 *
 * `DEV_ORIGINS` overrides the list for a web dev server on another port — a second
 * worktree, or two branches verified at once (#327). It never widens it beyond an
 * exact-match list of loopback origins, and it is only ever read in development.
 */
export const DEFAULT_DEV_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

/**
 * Validates one allowlist entry and returns its canonical origin, or throws naming the
 * entry.
 *
 * Parsed as a URL and compared structurally, never by string matching: an entry is
 * accepted only when it is http(s), carries no credentials, path, query or fragment,
 * and its *host* is loopback. String matching would accept
 * `http://localhost:5173.evil.example.com` and `http://evil.example.com#localhost:5173`,
 * both of which are remote origins. What goes into the allowlist is the parsed
 * `origin`, never the raw input, so a confusable spelling (`http://lo%63alhost:5199`,
 * `http://0x7f000001:5199`) collapses to the one origin a browser actually sends
 * rather than becoming an extra entry.
 */
function normalizeDevOrigin(entry: string): string {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`invalid dev origin ${JSON.stringify(entry)}: not a URL.`);
  }
  // A trailing dot is a legal absolute form of the name, but no browser sends one, so
  // an entry carrying it could never match. Drop it rather than allowlist a dead entry.
  const hostname = url.hostname.replace(/\.$/, "");
  const isBareOrigin = url.username === "" && url.password === "" && url.pathname === "/" && url.search === "";
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !isBareOrigin || url.hash !== "") {
    throw new Error(
      `invalid dev origin ${JSON.stringify(entry)}: expected http(s)://host[:port] with no credentials, path, query or fragment.`,
    );
  }
  // The one load-bearing check: everything above is hygiene, since `url.origin` drops
  // credentials, path, query and fragment anyway. A non-loopback origin is refused with
  // the supported way out, so a blocked setup does not get "fixed" by editing app.ts.
  if (!isLoopbackHost(hostname)) {
    throw new Error(
      `invalid dev origin ${JSON.stringify(entry)}: host ${JSON.stringify(hostname)} is not loopback. ` +
        "Only loopback origins are supported — forward the port (ssh -L, or a tunnel) so the browser's " +
        "origin is loopback rather than widening this allowlist.",
    );
  }
  // Re-parsed rather than concatenated into the allowlist, so the stored value is
  // whatever the URL parser calls this origin.
  return new URL(`${url.protocol}//${hostname}${url.port === "" ? "" : `:${url.port}`}`).origin;
}

/** Order-insensitive comparison of two allowlists. */
function sameOrigins(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedB = [...b].sort();
  return [...a].sort().every((origin, index) => origin === sortedB[index]);
}

/** Validates an allowlist, throwing on the first entry that is not a loopback origin. */
export function normalizeDevOrigins(entries: readonly string[]): string[] {
  return entries.map(normalizeDevOrigin);
}

/**
 * Reads the comma-separated `DEV_ORIGINS` allowlist. Unset or empty keeps today's
 * defaults; anything malformed throws, so the server refuses to start rather than
 * run with an allowlist the operator did not mean. Both failure modes are closed:
 * there is no value that widens CORS beyond exact-match loopback origins.
 */
export function parseDevOrigins(value: string | undefined): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) {
    return [...DEFAULT_DEV_ORIGINS];
  }
  try {
    return normalizeDevOrigins(entries);
  } catch (error) {
    throw new Error(`DEV_ORIGINS is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Conditions that are legal but likely to surprise, reported at startup. Kept here
 * rather than inline in `server.ts` so they are unit-testable — the entrypoint uses
 * top-level await and cannot be imported without starting a server.
 *
 * Never include the token: these go to stdout and to whatever collects it.
 */
export function startupWarnings(config: ServerConfig): string[] {
  const warnings: string[] = [];

  if (config.allowedHosts === false) {
    warnings.push(
      `bound to non-loopback host ${config.host}. The API is reachable from the network and Host header pinning is off.`,
    );
  }

  // A changed CORS allowlist is otherwise invisible: the browser blocks the call, the
  // server answers 204 with no header, and neither side says why — which is the whole
  // reason #327 was expensive to find. Say it once, at startup.
  if (config.isDev && !sameOrigins(config.devOrigins, DEFAULT_DEV_ORIGINS)) {
    warnings.push(
      `DEV_ORIGINS replaces the default dev CORS allowlist. Accepted: ${config.devOrigins.join(", ") || "(none)"}. ` +
        "The default Vite origins are not accepted unless listed.",
    );
  }

  return warnings;
}

/**
 * Reads the server's environment into a validated config, or throws with a message
 * naming the offending variable.
 *
 * Kept separate from `server.ts` so the bind guard is unit-testable: `server.ts` is a
 * top-level-await entrypoint that cannot be imported without starting a server.
 */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = read(env.HOST) ?? "127.0.0.1";
  const explicitToken = read(env.API_TOKEN);
  const isDev = env.NODE_ENV !== "production";

  // The generated fallback token is only printed on a development startup. Outside
  // development it would be known to nobody, so the server would bind, look healthy,
  // and answer 401 to every authenticated request — unusable by construction, not
  // merely misconfigured. Refuse rather than start something that cannot work (#241).
  if (!isDev && explicitToken === undefined) {
    throw new Error(
      "API_TOKEN must be set outside development: the generated fallback is never printed there, " +
        "so every authenticated request would fail with 401.",
    );
  }

  if (!isLoopbackHost(host)) {
    // Binding beyond loopback publishes every collection to the network. A token
    // generated at startup would be printed to a console nobody is watching, so
    // require the operator to have chosen one deliberately.
    if (explicitToken === undefined) {
      throw new Error(`Refusing to bind non-loopback HOST "${host}" without an explicit API_TOKEN.`);
    }
    if (explicitToken.length < MIN_NETWORK_TOKEN_LENGTH) {
      throw new Error(
        `API_TOKEN must be at least ${MIN_NETWORK_TOKEN_LENGTH} characters to bind non-loopback HOST "${host}".`,
      );
    }
  }

  return {
    // A fixed location anchored to the app directory (apps/api/data/app.db), resolved
    // from this module's URL so it is the SAME file regardless of the working directory
    // the server is launched from. A cwd-relative default would silently put the
    // database in different places, making collections appear to vanish.
    dbPath: read(env.DB_PATH) ?? fileURLToPath(new URL("../data/app.db", import.meta.url)),
    port: parsePort(read(env.PORT)),
    host,
    token: explicitToken ?? randomUUID(),
    isDev,
    // Host pinning defends the loopback default against DNS rebinding. On a LAN bind
    // there is no way to know which name a client will use, so pin nothing rather than
    // 403 every legitimate request.
    allowedHosts: isLoopbackHost(host) ? undefined : false,
    // Read only in development. Outside it the API answers no CORS request at all, so
    // there is nothing for this variable to configure and it is never looked at (#327).
    devOrigins: isDev ? parseDevOrigins(read(env.DEV_ORIGINS)) : [],
  };
}

/**
 * Environment variables are strings, so `env.X ?? default` treats an exported-but-empty
 * variable as a value. `HOST=""` then reaches `app.listen()`, where it binds every
 * interface — the exposure the guard above exists to prevent. Empty means unset.
 */
function read(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3001;
  }
  const port = Number(value);
  // 0 is legitimate: it asks the OS for a free port, which the integration test uses.
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${value}".`);
  }
  return port;
}

/** True for the addresses only this machine can reach. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  return (
    bare === "localhost" ||
    bare === "::1" ||
    bare === "::ffff:127.0.0.1" ||
    /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(bare)
  );
}
