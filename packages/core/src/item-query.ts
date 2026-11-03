/**
 * The query vocabulary for listing a collection's items (#41), shared by the API
 * that parses it and the web client that writes it into its URL.
 */

/** Longest search text the API accepts; the search box enforces the same cap. */
export const ITEM_SEARCH_MAX_LENGTH = 200;

export type ItemSortDirection = "asc" | "desc";

/**
 * What a list of items is ordered by. `name` is the item's display name — the
 * first schema field holding a scalar value, the same rule the web uses to name
 * an item in a message — and `field` orders by one schema field's value.
 */
export type ItemSort =
  | { key: "createdAt" | "updatedAt" | "name"; direction: ItemSortDirection }
  | { key: "field"; fieldId: string; direction: ItemSortDirection };

const FIELD_PREFIX = "field:";
const PLAIN_KEYS = new Set(["createdAt", "updatedAt", "name"]);

/**
 * Reads a sort key in the JSON:API style: one key, descending when prefixed with
 * `-`. A field id is everything after `field:`, so an id holding a colon (ids are
 * free text) still parses as itself. Returns null for anything else.
 */
export function parseItemSort(raw: string): ItemSort | null {
  const direction: ItemSortDirection = raw.startsWith("-") ? "desc" : "asc";
  const key = direction === "desc" ? raw.slice(1) : raw;
  if (PLAIN_KEYS.has(key)) {
    return { key: key as "createdAt" | "updatedAt" | "name", direction };
  }
  if (key.startsWith(FIELD_PREFIX) && key.length > FIELD_PREFIX.length) {
    return { key: "field", fieldId: key.slice(FIELD_PREFIX.length), direction };
  }
  return null;
}

/** The inverse of {@link parseItemSort}. */
export function formatItemSort(sort: ItemSort): string {
  const prefix = sort.direction === "desc" ? "-" : "";
  return sort.key === "field" ? `${prefix}${FIELD_PREFIX}${sort.fieldId}` : `${prefix}${sort.key}`;
}
