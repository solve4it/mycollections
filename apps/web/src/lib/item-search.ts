import { type FieldDefinition, ITEM_SEARCH_MAX_LENGTH, isSortableFieldType, parseItemSort } from "@mycollections/core";

/** A collection screen's search params (#41). */
export interface ItemSearch {
  q?: string;
  sort?: string;
}

/**
 * The collection route's `validateSearch`: keeps what the list can use and
 * drops the rest, so a mangled URL shows the whole collection rather than an
 * error. A primitive is turned back into text in case a value was parsed on
 * the way in; anything structured is dropped.
 */
export function validateItemSearch(raw: Record<string, unknown>): ItemSearch {
  const search: ItemSearch = {};
  const q = typeof raw.q === "string" || typeof raw.q === "number" ? String(raw.q) : "";
  if (q) search.q = q.slice(0, ITEM_SEARCH_MAX_LENGTH);
  if (typeof raw.sort === "string" && parseItemSort(raw.sort)) search.sort = raw.sort;
  return search;
}

/**
 * The sort to ask the API for. The URL can only be checked for shape, so a
 * field sort naming a field this collection no longer has — or one that cannot
 * be sorted — is dropped here rather than sent and answered with a 400 that
 * would read as "could not load items".
 */
export function effectiveSort(sort: string | undefined, fields: FieldDefinition[]): string | undefined {
  if (!sort) return undefined;
  const parsed = parseItemSort(sort);
  if (!parsed) return undefined;
  if (parsed.key !== "field") return sort;
  const field = fields.find((candidate) => candidate.id === parsed.fieldId);
  return field && isSortableFieldType(field.type) ? sort : undefined;
}
