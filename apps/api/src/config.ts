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
    isDev: env.NODE_ENV !== "production",
    // Host pinning defends the loopback default against DNS rebinding. On a LAN bind
    // there is no way to know which name a client will use, so pin nothing rather than
    // 403 every legitimate request.
    allowedHosts: isLoopbackHost(host) ? undefined : false,
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
