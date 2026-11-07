import {
  type FieldDefinition,
  filterSuitsField,
  formatItemFilters,
  ITEM_SEARCH_MAX_LENGTH,
  type ItemFilter,
  type ItemStatus,
  isSortableFieldType,
  parseItemFilters,
  parseItemSort,
} from "@mycollections/core";

/** A collection screen's search params (#41). */
export interface ItemSearch {
  q?: string;
  sort?: string;
  /** A filter list in canonical form (core's `formatItemFilters`). */
  filter?: string;
  /**
   * The status tab (#42). Absent means All: `?show=all` is never written, so
   * one view has one URL.
   */
  show?: "collected" | "remaining";
}

/**
 * The status tabs, in the order they are shown (#42). Collected is the items
 * whose status is Owned; Remaining is Wanted and Ordered — what is still to
 * come, whether looked for or already on its way.
 */
export const STATUS_TABS = ["all", "collected", "remaining"] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

/** The tab a collection screen's search selects. */
export function statusTabOf(search: Pick<ItemSearch, "show">): StatusTab {
  return search.show ?? "all";
}

/** Whether an item with this status is shown under this tab. */
export function inStatusTab(status: ItemStatus, tab: StatusTab): boolean {
  if (tab === "collected") return status === "owned";
  if (tab === "remaining") return status !== "owned";
  return true;
}

/**
 * The collection route's `validateSearch`: keeps what the list can use and
 * drops the rest, so a mangled URL shows the whole collection rather than an
 * error. A primitive is turned back into text in case a value was parsed on
 * the way in; anything structured is dropped.
 *
 * "Dropped" means named as `undefined`, never left out. TanStack Router lays
 * the validated search over the raw URL's, so a key missing from the result
 * lets the raw value show through — `?show=owned` reached the screen as a tab
 * that is none of the three (#42). `stringifySearch` writes an undefined value
 * as nothing, so the URL is the same.
 */
export function validateItemSearch(raw: Record<string, unknown>): ItemSearch {
  const search: ItemSearch = { q: undefined, sort: undefined, filter: undefined, show: undefined };
  const q = typeof raw.q === "string" || typeof raw.q === "number" ? String(raw.q) : "";
  if (q) search.q = q.slice(0, ITEM_SEARCH_MAX_LENGTH);
  if (typeof raw.sort === "string" && parseItemSort(raw.sort)) search.sort = raw.sort;
  // Re-spelled canonically, so two spellings of one filter are one URL and one
  // cache entry. An empty list is no filter at all.
  const filters = typeof raw.filter === "string" ? parseItemFilters(raw.filter) : null;
  if (filters && filters.length > 0) search.filter = formatItemFilters(filters);
  // "all" is the default, so it is dropped rather than kept as a second
  // spelling of the bare URL (R17); anything unknown is dropped with it.
  if (raw.show === "collected" || raw.show === "remaining") search.show = raw.show;
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

/**
 * The filters to ask the API for: those whose field this collection still has
 * and can take them. A filter left in a bookmark after its field was removed or
 * changed type is dropped rather than answered with a 400.
 */
export function effectiveFilters(filter: string | undefined, fields: FieldDefinition[]): ItemFilter[] {
  const filters = filter ? (parseItemFilters(filter) ?? []) : [];
  return filters.filter((candidate) => {
    const field = fields.find((f) => f.id === candidate.field);
    return field !== undefined && filterSuitsField(candidate, field.type);
  });
}
