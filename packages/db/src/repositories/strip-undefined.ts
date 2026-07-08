/**
 * Removes keys whose value is undefined. Callers often build patches from
 * optional inputs (e.g. `{ status: body.status }`), which produces explicitly
 * undefined keys; spreading those over an existing record would clobber stored
 * values. Stripping them makes explicit undefined behave like an absent key.
 */
export function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}
