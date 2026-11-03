/**
 * The DOM id of one control inside one instance of a component (#369).
 *
 * `prefix` is the instance's `useId()`, so two copies of a component on one
 * screen never share an id — `<label for>` resolves to the first element in the
 * document with that id, so a shared one labels the first copy twice and leaves
 * the second unnamed. `part` names the control (`"status"`, `"label"`), and
 * `key`, when there is one, is the data the control belongs to: a field's id, a
 * draft row's key.
 *
 * Those keys are arbitrary non-empty strings (core's field schema), and four
 * things follow from that:
 *
 * - An id may not contain whitespace, and `aria-describedby` is a
 *   space-separated list, so a key with a space in it would split the reference.
 * - Ids are also looked up as `#id` selectors (the keyboard spec finds a hint by
 *   its `aria-describedby` that way), so the result must be a plain CSS
 *   identifier: nothing like `:` or `%` that would need `CSS.escape`.
 * - The key cannot be joined to the part with a single dash, since both may
 *   contain one: `"type"` + `"hint-foo"` and `"type-hint"` + `"foo"` would meet.
 *   It is joined with `__`, which the encoding below never emits.
 * - The encoding has to be total. `encodeURIComponent` throws on an unpaired
 *   surrogate, which JSON carries happily, and it would throw during render.
 *
 * So every UTF-16 code unit outside `[A-Za-z0-9-]` — `_` included — becomes `_`
 * and four hex digits. Fixed width, and the escape character is itself escaped,
 * so no two keys encode alike, and an `_` in the output is always followed by a
 * hex digit, never by a second `_`. Part names are literals and never contain
 * `__`, so the first `__` after the prefix is always the join.
 */
export function scopedId(prefix: string, part: string, key?: string): string {
  return key === undefined ? `${prefix}-${part}` : `${prefix}-${part}__${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key.charAt(i);
    out += /[A-Za-z0-9-]/.test(ch) ? ch : `_${key.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }
  return out;
}
