import { z } from "zod";
import type { FieldDefinition } from "./field.js";
import { ItemFieldValueSchema } from "./item.js";
import { ITEM_STATUSES, type ItemStatus, ItemStatusSchema } from "./status.js";

/**
 * Shared rules for importing items from a table (#44). The browser uses
 * `coerceCell` to turn each CSV cell into a typed value for the preview, and the
 * server runs `checkImportedFields` over what it receives, so the two cannot
 * disagree about what a valid row is: the server re-validates typed values, it
 * never re-reads the strings.
 */

/** The most rows one import may carry. */
export const ITEM_IMPORT_MAX_ROWS = 10_000;

/** The longest text one cell may hold, after trimming. */
export const ITEM_IMPORT_MAX_CELL_LENGTH = 10_000;

/**
 * What separates the choices in a multiselect cell. One fixed character, since
 * an option may itself hold a comma ("Blue, dark"). Tags split on commas, as the
 * item form does.
 */
export const MULTISELECT_SEPARATOR = ";";

/** Why a cell or a value was refused. Fixed words: never the value itself. */
export type ImportIssue = "invalid" | "required" | "too-long";

export type CoerceResult<T = unknown> = { ok: true; value: T } | { ok: false; issue: ImportIssue };

/**
 * What the item form stores for a field nobody filled in (DynamicItemForm's
 * `fromDraft`), so an imported row looks exactly like one typed in by hand —
 * filters and sorts treat them alike.
 */
export function emptyFieldValue(field: FieldDefinition): unknown {
  switch (field.type) {
    case "number":
    case "currency":
    case "rating":
      return null;
    case "boolean":
      return false;
    case "tags":
    case "multiselect":
      return [];
    default:
      return "";
  }
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
// An optional minus, at most one currency symbol, then digits — grouped by
// commas in threes, or not grouped at all — and an optional fraction.
const CURRENCY = /^(-)?\p{Sc}?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRUE_WORDS = new Set(["true", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0"]);
const UrlSchema = z.url({ protocol: /^https?$/ });
const EmailSchema = z.email();

/** A real calendar date in YYYY-MM-DD form: 2023-02-29 is refused. */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** An exact option, else the one option equal ignoring case; never a guess between two. */
function matchOption(options: readonly string[], raw: string): string | null {
  if (options.includes(raw)) return raw;
  const folded = raw.toLowerCase();
  const matches = options.filter((option) => option.toLowerCase() === folded);
  return matches.length === 1 ? (matches[0] as string) : null;
}

const ok = <T>(value: T): CoerceResult<T> => ({ ok: true, value });
const refuse = (issue: ImportIssue): CoerceResult<never> => ({ ok: false, issue });
// A digit string past about 309 digits reads as Infinity, which JSON sends as null:
// the preview would show a value the server then stores empty, or refuses.
const finite = (value: number): CoerceResult => (Number.isFinite(value) ? ok(value) : refuse("invalid"));

/** Turns one CSV cell into the value the item form would have stored for it. */
export function coerceCell(field: FieldDefinition, raw: string): CoerceResult {
  const cell = raw.trim();
  if (cell.length > ITEM_IMPORT_MAX_CELL_LENGTH) return refuse("too-long");
  if (cell === "") return field.required && field.type !== "boolean" ? refuse("required") : ok(emptyFieldValue(field));
  switch (field.type) {
    case "text":
      return ok(cell);
    case "number":
      return DECIMAL.test(cell) ? finite(Number(cell)) : refuse("invalid");
    case "currency": {
      const match = CURRENCY.exec(cell);
      if (!match) return refuse("invalid");
      return finite(Number(`${match[1] ?? ""}${(match[2] as string).replaceAll(",", "")}${match[3] ?? ""}`));
    }
    case "rating": {
      if (!/^\d+$/.test(cell)) return refuse("invalid");
      const value = Number(cell);
      return value <= field.max ? ok(value) : refuse("invalid");
    }
    case "boolean": {
      const word = cell.toLowerCase();
      if (TRUE_WORDS.has(word)) return ok(true);
      if (FALSE_WORDS.has(word)) return ok(false);
      return refuse("invalid");
    }
    case "date":
      return isIsoDate(cell) ? ok(cell) : refuse("invalid");
    case "url":
      return UrlSchema.safeParse(cell).success ? ok(cell) : refuse("invalid");
    case "email":
      return EmailSchema.safeParse(cell).success ? ok(cell) : refuse("invalid");
    case "select": {
      const option = matchOption(field.options, cell);
      return option === null ? refuse("invalid") : ok(option);
    }
    case "multiselect": {
      const chosen: string[] = [];
      for (const part of cell.split(MULTISELECT_SEPARATOR)) {
        const trimmed = part.trim();
        if (trimmed === "") continue;
        const option = matchOption(field.options, trimmed);
        if (option === null) return refuse("invalid");
        if (!chosen.includes(option)) chosen.push(option);
      }
      if (chosen.length === 0 && field.required) return refuse("required");
      return ok(chosen);
    }
    case "tags": {
      const values = cell
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (values.length === 0 && field.required) return refuse("required");
      return ok(values);
    }
    case "image":
      // Images come with their files, through the backup import or the item page.
      return refuse("invalid");
  }
}

/**
 * Reads a status column: a status key, or its label in the current language
 * (passed in, since core holds no translations). An empty cell is `undefined`,
 * which the import leaves to the default status.
 */
export function coerceStatus(raw: string, labels: Record<ItemStatus, string>): CoerceResult<ItemStatus | undefined> {
  const cell = raw.trim().toLowerCase();
  if (cell === "") return ok(undefined);
  for (const status of ITEM_STATUSES) {
    if (cell === status || cell === labels[status].trim().toLowerCase()) return ok(status);
  }
  return refuse("invalid");
}

const isText = (value: unknown, max = ITEM_IMPORT_MAX_CELL_LENGTH): value is string =>
  typeof value === "string" && value.length <= max;

function checkShape(field: FieldDefinition, value: unknown): ImportIssue | null {
  switch (field.type) {
    case "text":
      return isText(value) ? null : "invalid";
    case "number":
    case "currency":
      return typeof value === "number" && Number.isFinite(value) ? null : "invalid";
    case "rating":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= field.max ? null : "invalid";
    case "boolean":
      return typeof value === "boolean" ? null : "invalid";
    case "date":
      return typeof value === "string" && isIsoDate(value) ? null : "invalid";
    case "url":
      return isText(value) && UrlSchema.safeParse(value).success ? null : "invalid";
    case "email":
      return isText(value) && EmailSchema.safeParse(value).success ? null : "invalid";
    case "select":
      return typeof value === "string" && field.options.includes(value) ? null : "invalid";
    case "multiselect":
      return Array.isArray(value) &&
        value.every((v) => typeof v === "string" && field.options.includes(v)) &&
        new Set(value).size === value.length
        ? null
        : "invalid";
    case "tags":
      return Array.isArray(value) && value.every((v) => isText(v) && v !== "" && v.trim() === v && !v.includes(","))
        ? null
        : "invalid";
    case "image":
      return "invalid";
  }
}

/**
 * Checks a typed value against its field: the shape `coerceCell` produces, or
 * the field's empty value. Returns why it was refused, or null.
 */
export function validateFieldValue(field: FieldDefinition, value: unknown): ImportIssue | null {
  if (typeof value === "string" && value.length > ITEM_IMPORT_MAX_CELL_LENGTH) return "too-long";
  const empty = emptyFieldValue(field);
  const unfilled = Array.isArray(empty) ? Array.isArray(value) && value.length === 0 : value === empty;
  // An unchecked box is an answer, so a required yes/no field is never unfilled.
  if (unfilled) return field.required && field.type !== "boolean" ? "required" : null;
  return checkShape(field, value);
}

export type CheckedFields =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; issue: "unknown-field" }
  | { ok: false; issue: ImportIssue; fieldId: string };

/**
 * Checks one imported row's fields against the collection's definitions: every
 * key must be a field of the collection, every value valid for its field, and
 * every required field filled. Fields the row leaves out get their empty value,
 * so the stored item has one key per field, as a form-made item does.
 */
export function checkImportedFields(
  definitions: readonly FieldDefinition[],
  values: Record<string, unknown>,
): CheckedFields {
  const known = new Set(definitions.map((definition) => definition.id));
  // Object.keys sees an own "__proto__" key, which JSON.parse creates.
  if (Object.keys(values).some((key) => !known.has(key))) return { ok: false, issue: "unknown-field" };
  const fields: [string, unknown][] = [];
  for (const definition of definitions) {
    const value = Object.hasOwn(values, definition.id) ? values[definition.id] : emptyFieldValue(definition);
    const issue = validateFieldValue(definition, value);
    if (issue !== null) return { ok: false, issue, fieldId: definition.id };
    fields.push([definition.id, value]);
  }
  return { ok: true, fields: Object.fromEntries(fields) };
}

/** The body of an item import: rows already typed, at most ITEM_IMPORT_MAX_ROWS. */
export const ItemImportRequestSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        status: ItemStatusSchema.optional(),
        fields: z.record(z.string(), ItemFieldValueSchema),
      }),
    )
    .min(1)
    .max(ITEM_IMPORT_MAX_ROWS),
});

export type ItemImportRequest = z.infer<typeof ItemImportRequestSchema>;
