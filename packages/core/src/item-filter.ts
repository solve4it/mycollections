import { z } from "zod";

/**
 * Structured filters for a collection's items (#41), shared by the API that
 * applies them and the web client that writes them into its URL.
 *
 * The wire format is a JSON array in one `filter` param — the approach
 * Directus takes, and compatible with JSON:API, which reserves `filter` but
 * leaves its contents to the API. Operator names follow the common
 * Mongo/Strapi/Directus vocabulary. Filters AND together.
 *
 * | op      | field types                    | value                 |
 * | ------- | ------------------------------ | --------------------- |
 * | `in`    | select, multiselect, tags      | values; any matches   |
 * | `all`   | multiselect, tags              | values; all present   |
 * | `gte`   | number, rating, currency, date | number, or YYYY-MM-DD |
 * | `lte`   | number, rating, currency, date | number, or YYYY-MM-DD |
 * | `eq`    | boolean                        | true or false         |
 * | `empty` | any filterable field           | —                     |
 *
 * Which op suits which field is the repository's call, made against the
 * collection's current schema; this schema only checks shape.
 */

/** At most this many filters in one query. */
export const ITEM_FILTER_MAX = 10;
/** At most this many values in one `in`/`all` list. */
export const ITEM_FILTER_MAX_VALUES = 20;
/** Longest single value. */
export const ITEM_FILTER_MAX_VALUE_LENGTH = 200;
/**
 * Longest raw `filter` param accepted, in characters, checked before
 * `JSON.parse` so a crafted link cannot hand the parser megabytes.
 *
 * It does not by itself keep a request inside Node's 16 KB header limit: URL
 * encoding can take a character to 9 bytes, so 2048 characters of non-ASCII
 * text arrive as an 18 KB URL that Node refuses with a 431 before the API sees
 * it. The web client measures the encoded URL before it sends one.
 */
export const ITEM_FILTER_MAX_RAW_LENGTH = 2048;

// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]*$/;

const fieldId = z.string().min(1).max(300).regex(NO_CONTROL_CHARACTERS);
const listValue = z.string().trim().min(1).max(ITEM_FILTER_MAX_VALUE_LENGTH).regex(NO_CONTROL_CHARACTERS);
const valueList = z
  .array(listValue)
  .min(1)
  .max(ITEM_FILTER_MAX_VALUES)
  .transform((values) => [...new Set(values)]);
const bound = z.union([z.number().finite(), z.iso.date()]);

export const ItemFilterSchema = z.discriminatedUnion("op", [
  z.strictObject({ field: fieldId, op: z.literal("in"), value: valueList }),
  z.strictObject({ field: fieldId, op: z.literal("all"), value: valueList }),
  z.strictObject({ field: fieldId, op: z.literal("gte"), value: bound }),
  z.strictObject({ field: fieldId, op: z.literal("lte"), value: bound }),
  z.strictObject({ field: fieldId, op: z.literal("eq"), value: z.boolean() }),
  z.strictObject({ field: fieldId, op: z.literal("empty") }),
]);

export type ItemFilter = z.infer<typeof ItemFilterSchema>;

/**
 * At most one filter per field and operator: two `in` filters on one field
 * would AND into something the filter panel cannot show — it holds one set of
 * choices per field — and two chips would share an identity.
 */
export const ItemFilterListSchema = z
  .array(ItemFilterSchema)
  .max(ITEM_FILTER_MAX)
  .refine((filters) => new Set(filters.map((filter) => `${filter.op} ${filter.field}`)).size === filters.length, {
    message: "One filter per field and operator",
  });

/**
 * Reads a `filter` param. Returns null for anything that is not a valid list —
 * too long, not JSON, or the wrong shape. Callers use only the returned value,
 * never the raw parse: a `__proto__` key survives `JSON.parse` as an own key.
 */
export function parseItemFilters(raw: string): ItemFilter[] | null {
  if (!raw || raw.length > ITEM_FILTER_MAX_RAW_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ItemFilterListSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** The canonical text of a filter list — one spelling per meaning, for URLs and cache keys. */
export function formatItemFilters(filters: ItemFilter[]): string {
  return JSON.stringify(filters);
}

const NUMERIC_TYPES = new Set(["number", "rating", "currency"]);
const LIST_TYPES = new Set(["multiselect", "tags"]);
const FILTERABLE_TYPES = new Set(["select", "multiselect", "tags", "number", "rating", "currency", "date", "boolean"]);

/** Field types that take filters. Text, url, email and image do not — search covers text. */
export function isFilterableFieldType(type: string): boolean {
  return FILTERABLE_TYPES.has(type);
}

/**
 * Whether a filter can be applied to a field of this type — the one rule the
 * repository enforces and the web client uses to drop filters a changed schema
 * no longer supports.
 */
export function filterSuitsField(filter: ItemFilter, type: string): boolean {
  switch (filter.op) {
    case "empty":
      return FILTERABLE_TYPES.has(type);
    case "in":
      return type === "select" || LIST_TYPES.has(type);
    case "all":
      return LIST_TYPES.has(type);
    case "gte":
    case "lte":
      return typeof filter.value === "number" ? NUMERIC_TYPES.has(type) : type === "date";
    case "eq":
      return type === "boolean";
  }
}
