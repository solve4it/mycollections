/**
 * A data key made safe to embed in a DOM id (#369).
 *
 * Components that can render more than once take their id prefix from React's
 * `useId()` and append the key of the thing each control belongs to — a field's
 * id, a draft row's key. Those keys are arbitrary non-empty strings (core's
 * field schema), but an HTML id may not contain whitespace, and
 * `aria-describedby` is a space-separated list of ids, so a raw
 * key with a space in it would split the reference in two.
 *
 * Percent-encoding rather than replacing whitespace, because no two keys encode alike:
 * `"release year"` and `"release_year"` stay two different ids.
 */
export function domIdPart(key: string): string {
  return encodeURIComponent(key);
}
