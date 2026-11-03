/**
 * The router's search serialization (#41): every value a plain string, as
 * written.
 *
 * TanStack Router's default JSON-parses each value, so `?q=1984` reached the
 * screen as the number 1984, `?q=01984` lost its zero and `?q=true` became a
 * boolean — and on the way out a string that looked like JSON was written with
 * quotes (`?q=%221984%22`). Search text is text; nothing in this app puts a
 * structured value in the URL.
 */
export function parseSearch(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  // toString, not `params.size`: Safari 16 and Chrome 111 — inside Vite's
  // default build target — have no `size`, and every search would vanish.
  const query = params.toString();
  return query ? `?${query}` : "";
}
