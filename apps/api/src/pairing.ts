import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time pairing codes (#241), the Jupyter-style link that hands a browser the device
 * token without anyone copying it out of a terminal.
 *
 * Deliberately long rather than easy to type: 256 bits cannot be guessed, so pairing needs no
 * rate limiter (#247) — and on a loopback API an IP-keyed limiter is one global bucket,
 * which would only give a local process a way to stop the owner pairing. For the same
 * reason a wrong guess never burns the real code.
 */

/** How long a code stays redeemable. Restarting the API mints a fresh one. */
export const PAIRING_TTL_MS = 15 * 60 * 1000;

/** The shape of a code: 32 random bytes in base64url. */
export const PAIRING_CODE_PATTERN = "^[A-Za-z0-9_-]{43}$";

export interface PairingCodesOptions {
  now?: () => number;
  ttlMs?: number;
}

export class PairingCodes {
  readonly #now: () => number;
  readonly #ttlMs: number;
  /** Only a digest is held, so comparison takes the same time whatever the input's length. */
  #current: { digest: Buffer; expiresAt: number } | null = null;

  constructor(options: PairingCodesOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
  }

  /** Mints a new code, retiring any previous one: one link is live at a time. */
  mint(): string {
    const code = randomBytes(32).toString("base64url");
    this.#current = { digest: digest(code), expiresAt: this.#now() + this.#ttlMs };
    return code;
  }

  /**
   * True exactly once for the live code. The code is retired synchronously, before the
   * caller can reply, so two concurrent requests carrying it cannot both succeed.
   */
  redeem(code: string): boolean {
    const current = this.#current;
    if (current === null) return false;
    if (this.#now() >= current.expiresAt) {
      this.#current = null;
      return false;
    }
    if (!timingSafeEqual(digest(code), current.digest)) return false;
    this.#current = null;
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * The link a browser follows to pair. The code rides in the fragment, which the browser
 * never sends to a server — so it reaches neither the web server's log nor a `Referer`.
 */
export function pairingLink(webOrigin: string, code: string): string {
  return `${new URL("/setup", webOrigin).href}#pair=${code}`;
}

/**
 * Pairing exists only where its threat model holds: development, a loopback bind (Host
 * pinning on, so a DNS-rebinding page cannot reach the route), and a database on disk.
 * Outside development `API_TOKEN` is mandatory and set deliberately (#248); a
 * non-loopback bind would put the route in front of the network; an in-memory database
 * is the e2e suite, which pins its own token.
 */
export function isPairingEnabled(config: { isDev: boolean; allowedHosts?: string[] | false; dbPath: string }): boolean {
  return config.isDev && config.allowedHosts !== false && config.dbPath !== ":memory:";
}
