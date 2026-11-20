import {
  coerceCell,
  coerceStatus,
  type FieldDefinition,
  type ImportIssue,
  ITEM_IMPORT_MAX_ROWS,
  type ItemImportRequest,
  type ItemStatus,
} from "@mycollections/core";
import Papa from "papaparse";

/**
 * Reading a CSV file for the import wizard (#44): parse it, suggest which column
 * fills which field, and type every cell with core's rules — the same rules the
 * server checks the rows against, so the preview is what will be stored.
 */

/** The largest file the browser will read, comfortably above 10,000 ordinary rows. */
export const CSV_MAX_BYTES = 10 * 1024 * 1024;

/** The most columns a file may have: each one is a row on the mapping step. */
export const CSV_MAX_COLUMNS = 100;

export interface CsvTable {
  /** The first row, each header trimmed. */
  headers: string[];
  /** Every row under it, padded to the header's width; cells as written. */
  rows: string[][];
}

export type CsvReadFailure = "too-large" | "encoding" | "unreadable" | "empty" | "too-many-rows" | "too-many-columns";

export type CsvReadResult = { ok: true; table: CsvTable } | { ok: false; reason: CsvReadFailure };

/** What one column fills: a field, the item's status, or nothing. */
export type ColumnTarget = { kind: "skip" } | { kind: "status" } | { kind: "field"; fieldId: string };

/** One row of the file, typed — or the cells that would not convert, by column. */
export type RowResult =
  | { row: number; ok: true; item: ImportRow }
  | { row: number; ok: false; issues: { column: number; issue: ImportIssue }[] };

type ImportRow = ItemImportRequest["items"][number];

/** A UTF-16 file starts with one of these byte order marks; Excel's "Unicode text" does. */
function isUtf16(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
}

/**
 * Reads a UTF-8 CSV file whose first row names its columns. Columns are kept by
 * position, never keyed by header, so duplicate, blank or odd headers ("__proto__")
 * are only labels. Cells stay text: "007" is not the number 7.
 */
export async function readCsv(file: File): Promise<CsvReadResult> {
  if (file.size > CSV_MAX_BYTES) return { ok: false, reason: "too-large" };
  if (isUtf16(new Uint8Array(await file.slice(0, 2).arrayBuffer()))) return { ok: false, reason: "encoding" };
  const text = (await file.text()).replace(/^﻿/, "");
  // Delimiter left to detection: spreadsheets set to European locales write ";".
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy", dynamicTyping: false });
  if (parsed.errors.some((error) => error.type === "Quotes")) return { ok: false, reason: "unreadable" };
  const [first, ...rest] = parsed.data;
  if (!first || rest.length === 0) return { ok: false, reason: "empty" };
  if (first.length > CSV_MAX_COLUMNS) return { ok: false, reason: "too-many-columns" };
  if (rest.length > ITEM_IMPORT_MAX_ROWS) return { ok: false, reason: "too-many-rows" };
  const width = first.length;
  return {
    ok: true,
    table: {
      headers: first.map((header) => header.trim()),
      rows: rest.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
    },
  };
}

const fold = (value: string) => value.trim().toLowerCase();

/**
 * A first guess at the mapping: a column whose header is a field's label or id
 * fills that field, and one named like the status column fills the status —
 * ignoring case and surrounding spaces, each target given to the first column
 * that claims it. Image fields are never offered: images arrive with their files.
 */
export function suggestMapping(
  headers: readonly string[],
  fields: readonly FieldDefinition[],
  statusHeaders: readonly string[],
): ColumnTarget[] {
  const taken = new Set<string>();
  const statusNames = new Set(statusHeaders.map(fold));
  return headers.map((header): ColumnTarget => {
    const name = fold(header);
    if (name === "") return { kind: "skip" };
    const field = fields.find(
      (candidate) => candidate.type !== "image" && (fold(candidate.label) === name || fold(candidate.id) === name),
    );
    if (field && !taken.has(field.id)) {
      taken.add(field.id);
      return { kind: "field", fieldId: field.id };
    }
    if (!field && statusNames.has(name) && !taken.has("status")) {
      taken.add("status");
      return { kind: "status" };
    }
    return { kind: "skip" };
  });
}

const targetKey = (target: ColumnTarget) =>
  target.kind === "field" ? `field:${target.fieldId}` : target.kind === "status" ? "status" : null;

/**
 * What stops a mapping from being used: required fields no column fills, and the
 * columns (by index) that choose a target an earlier column already chose.
 */
export function mappingProblems(
  mapping: readonly ColumnTarget[],
  fields: readonly FieldDefinition[],
): { missingRequired: string[]; duplicateColumns: number[] } {
  const seen = new Set<string>();
  const duplicateColumns: number[] = [];
  mapping.forEach((target, column) => {
    const key = targetKey(target);
    if (key === null) return;
    if (seen.has(key)) duplicateColumns.push(column);
    seen.add(key);
  });
  const missingRequired = fields
    .filter((field) => field.required && field.type !== "boolean" && !seen.has(`field:${field.id}`))
    .map((field) => field.id);
  return { missingRequired, duplicateColumns };
}

/**
 * Types every row with the mapping. Rows are numbered from 1, as the preview
 * shows them. `items` holds only the rows that converted, which is what the
 * import sends; the rest are skipped and counted (decided with the owner).
 * Fields no column fills are left out, and the server stores their empty value.
 */
export function convertRows(
  table: CsvTable,
  mapping: readonly ColumnTarget[],
  fields: readonly FieldDefinition[],
  statusLabels: Record<ItemStatus, string>,
): { rows: RowResult[]; items: ImportRow[] } {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const rows = table.rows.map((cells, index): RowResult => {
    // No prototype: a field id is free text, and "__proto__" must be a plain key.
    const values: Record<string, unknown> = Object.create(null);
    let status: ItemStatus | undefined;
    const issues: { column: number; issue: ImportIssue }[] = [];
    mapping.forEach((target, column) => {
      const raw = cells[column] ?? "";
      if (target.kind === "status") {
        const result = coerceStatus(raw, statusLabels);
        if (result.ok) status = result.value;
        else issues.push({ column, issue: result.issue });
        return;
      }
      if (target.kind !== "field") return;
      const field = byId.get(target.fieldId);
      if (!field) return;
      const result = coerceCell(field, raw);
      if (result.ok) values[field.id] = result.value;
      else issues.push({ column, issue: result.issue });
    });
    if (issues.length > 0) return { row: index + 1, ok: false, issues };
    return { row: index + 1, ok: true, item: status === undefined ? { fields: values } : { status, fields: values } };
  });
  const items = rows.flatMap((row) => (row.ok ? [row.item] : []));
  return { rows, items };
}
