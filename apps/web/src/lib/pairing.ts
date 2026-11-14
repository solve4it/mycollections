/**
 * Reading a one-time pairing code (#241) out of what the setup screen is given: the
 * router's hash (`pair=…`), `location.hash` (`#pair=…`), or the whole link the API
 * printed, pasted into the token field.
 *
 * Only a fragment counts. The API puts the code after `#` so it never reaches a server
 * log or a `Referer`; a code in a query string has already been sent somewhere, and
 * this does not encourage the habit by accepting it.
 */
const CODE = /(?:^|[#&])pair=([A-Za-z0-9_-]{43})(?:&|$)/;

export function pairingCodeFrom(text: string): string | null {
  const trimmed = text.trim();
  const hashIndex = trimmed.indexOf("#");
  // A bare router hash has no "#"; a link or location.hash does, and only what follows it is fragment.
  const fragment = hashIndex === -1 ? (trimmed.includes("://") ? "" : trimmed) : trimmed.slice(hashIndex);
  return CODE.exec(fragment)?.[1] ?? null;
}
