import type { FieldDefinition, ItemFilter } from "@mycollections/core";

/**
 * The filter panel's form state (#41): one facet per filterable field, edited
 * freely and turned into filters only when the user applies them.
 */
export type FacetDraft =
  | { kind: "choice"; values: string[]; match: "in" | "all" }
  | { kind: "range"; min: string; max: string }
  | { kind: "boolean"; value: "any" | "yes" | "no" | "unset" };

export type FilterDraft = Record<string, FacetDraft>;

const CHOICE_TYPES = new Set(["select", "multiselect", "tags"]);
const RANGE_TYPES = new Set(["number", "rating", "currency", "date"]);

/** The facet a field type gets, or none — text, url, email and image are left to search. */
export function facetKind(type: string): FacetDraft["kind"] | null {
  if (CHOICE_TYPES.has(type)) return "choice";
  if (RANGE_TYPES.has(type)) return "range";
  if (type === "boolean") return "boolean";
  return null;
}

export function draftFromFilters(filters: ItemFilter[], fields: FieldDefinition[]): FilterDraft {
  const draft: FilterDraft = {};
  for (const field of fields) {
    const kind = facetKind(field.type);
    if (kind === "choice") draft[field.id] = { kind, values: [], match: "in" };
    if (kind === "range") draft[field.id] = { kind, min: "", max: "" };
    if (kind === "boolean") draft[field.id] = { kind, value: "any" };
  }
  for (const filter of filters) {
    const facet = draft[filter.field];
    if (!facet) continue;
    if (facet.kind === "choice" && (filter.op === "in" || filter.op === "all")) {
      draft[filter.field] = { kind: "choice", values: [...filter.value], match: filter.op };
    } else if (facet.kind === "range" && filter.op === "gte") {
      draft[filter.field] = { ...facet, min: String(filter.value) };
    } else if (facet.kind === "range" && filter.op === "lte") {
      draft[filter.field] = { ...facet, max: String(filter.value) };
    } else if (facet.kind === "boolean" && filter.op === "eq") {
      draft[filter.field] = { kind: "boolean", value: filter.value ? "yes" : "no" };
    } else if (facet.kind === "boolean" && filter.op === "empty") {
      draft[filter.field] = { kind: "boolean", value: "unset" };
    }
  }
  return draft;
}

function bound(raw: string, type: string): number | string | null {
  const text = raw.trim();
  if (!text) return null;
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** The filters a draft asks for, in schema order — the one spelling a draft has. */
export function filtersFromDraft(draft: FilterDraft, fields: FieldDefinition[]): ItemFilter[] {
  const filters: ItemFilter[] = [];
  for (const field of fields) {
    const facet = draft[field.id];
    if (!facet) continue;
    if (facet.kind === "choice" && facet.values.length > 0) {
      // "All of one value" is "any of one value"; one spelling keeps the URL canonical.
      const op = facet.match === "all" && facet.values.length > 1 ? "all" : "in";
      filters.push({ field: field.id, op, value: facet.values });
    } else if (facet.kind === "range") {
      const min = bound(facet.min, field.type);
      const max = bound(facet.max, field.type);
      if (min !== null) filters.push({ field: field.id, op: "gte", value: min });
      if (max !== null) filters.push({ field: field.id, op: "lte", value: max });
    } else if (facet.kind === "boolean" && facet.value !== "any") {
      filters.push(
        facet.value === "unset"
          ? { field: field.id, op: "empty" }
          : { field: field.id, op: "eq", value: facet.value === "yes" },
      );
    }
  }
  return filters;
}
