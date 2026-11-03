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
 * Those keys are arbitrary non-empty strings (core's field schema), and three
 * things follow from that:
 *
 * - An id may not contain whitespace, and `aria-describedby` is a
 *   space-separated list, so a key with a space in it would split the reference.
 * - The key cannot be joined to the part with a dash, since both may contain
 *   one: `"type"` + `"hint-foo"` and `"type-hint"` + `"foo"` would meet. The key
 *   is joined with `:` instead, which the encoding below never emits.
 * - The encoding has to be total. `encodeURIComponent` throws on an unpaired
 *   surrogate, which JSON carries happily, and it would throw during render.
 *
 * So every UTF-16 code unit outside `[A-Za-z0-9_-]` becomes `%` and four hex
 * digits. Fixed width, and `%` itself is escaped, so no two keys encode alike.
 */
export function scopedId(prefix: string, part: string, key?: string): string {
  return key === undefined ? `${prefix}-${part}` : `${prefix}-${part}:${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key.charAt(i);
    out += /[A-Za-z0-9_-]/.test(ch) ? ch : `%${key.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }
  return out;
}
