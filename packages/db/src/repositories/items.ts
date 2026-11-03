import { randomUUID } from "node:crypto";
import {
  type DeletedItem,
  type FieldDefinition,
  ITEM_FILTER_MAX_VALUE_LENGTH,
  type Item,
  type ItemFilter,
  ItemSchema,
  type ItemSort,
  type ItemStatus,
} from "@mycollections/core";
import { and, asc, desc, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as schema from "../schema.js";
import type { ReadOptions } from "./collections.js";
import { stripUndefined } from "./strip-undefined.js";

type Db = BetterSQLite3Database<typeof schema>;
type ItemRow = typeof schema.items.$inferSelect;

export interface CreateItemInput {
  collectionId: string;
  status?: ItemStatus;
  fields: Record<string, unknown>;
}

export interface UpdateItemInput {
  status?: ItemStatus;
  fields?: Record<string, unknown>;
}

export interface ListItemsOptions extends ReadOptions {
  status?: ItemStatus;
  /** Free text; every word must prefix-match a searchable value (#41). */
  q?: string;
  /** Defaults to search rank when `q` has terms, else insertion order. */
  sort?: ItemSort;
  /** Structured filters, ANDed (#41); see `item-filter.ts` in core for the vocabulary. */
  filters?: ItemFilter[];
}

/**
 * A list query that names something the collection cannot be ordered or
 * filtered by. The message is fixed text, safe to return to a client — it never
 * echoes the field id or the query.
 */
export class InvalidItemQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidItemQueryError";
  }
}

/**
 * The FTS5 index the 0001 migration maintains, and the table giving each item
 * the stable integer key that is its FTS rowid. Declared here rather than in
 * `schema.ts` so drizzle-kit never tries to generate DDL for them — the
 * migration's triggers are their only writers.
 */
const itemsFts = sqliteTable("items_fts", { rowid: integer("rowid"), body: text("body") });
const itemsSearchKey = sqliteTable("items_search_key", { key: integer("key"), itemId: text("item_id") });

/**
 * How many schema fields, in order, the name sort looks through for a name. It
 * bounds the SQL: each field is one COALESCE argument, and SQLite refuses more
 * than 1000. A name past the hundredth field is not a name anyone set out to sort by.
 */
const NAME_SORT_MAX_FIELDS = 100;

/** One tag in use, and how many items carry it. */
export interface TagValue {
  value: string;
  count: number;
}

/** Any control character, as a GLOB pattern (NUL cannot occur in one, nor in a bound value). */
const CONTROL_CHARACTER_GLOB = "*[\u0001-\u001f\u007f]*";

/** How many tags `tagValues` suggests at most. */
export const TAG_VALUES_LIMIT = 50;

/** At most this many distinct search terms are used; the rest are ignored. */
const MAX_SEARCH_TERMS = 10;

/**
 * Turns free text into an FTS5 MATCH expression that cannot carry FTS syntax:
 * each word becomes a quoted prefix phrase (`"word"*`, inner quotes doubled),
 * and the phrases AND together. Control characters are blanked first — a NUL
 * ends the string early inside SQLite and makes MATCH throw — and words without
 * a letter or digit are dropped, since a punctuation-only phrase matches nothing.
 * Returns null when no term survives, meaning "no search".
 */
export function toMatchExpression(q: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const words = q.replace(/[\u0000-\u001f\u007f]/g, " ").split(/\s+/);
  const terms = [...new Set(words.filter((word) => /[\p{L}\p{N}]/u.test(word)))].slice(0, MAX_SEARCH_TERMS);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
}

/**
 * A JSON path addressing one top-level key of an item's fields. Field ids are
 * free text, so the id is quoted and escaped per JSON string rules. Returns null
 * for an id holding a NUL, which SQLite's path parser cannot represent.
 */
export function fieldPath(fieldId: string): string | null {
  if (fieldId.includes("\u0000")) return null;
  return `$."${fieldId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const NUMERIC_FIELD_TYPES = new Set(["number", "rating", "currency"]);
const TEXT_FIELD_TYPES = new Set(["text", "url", "email", "select", "date"]);

/** The sortable value of one field, by its schema type; null for an unsortable type. */
function fieldSortValue(field: FieldDefinition, path: string): SQL | null {
  const column = schema.items.fields;
  if (NUMERIC_FIELD_TYPES.has(field.type)) {
    return sql`(CASE WHEN json_type(${column}, ${path}) IN ('integer', 'real') THEN json_extract(${column}, ${path}) END)`;
  }
  if (TEXT_FIELD_TYPES.has(field.type)) {
    return sql`(CASE WHEN json_type(${column}, ${path}) = 'text' AND json_extract(${column}, ${path}) <> '' THEN json_extract(${column}, ${path}) END)`;
  }
  if (field.type === "boolean") {
    return sql`(CASE json_type(${column}, ${path}) WHEN 'true' THEN 1 WHEN 'false' THEN 0 END)`;
  }
  return null;
}

/**
 * An item's display name in SQL: the first schema field, in schema order, whose
 * value is a non-empty string, a number or a boolean — the rule `itemLabel` in
 * the web app uses to name an item — among the first {@link NAME_SORT_MAX_FIELDS}.
 */
function nameSortValue(fields: FieldDefinition[]): SQL | null {
  const column = schema.items.fields;
  const candidates = fields.slice(0, NAME_SORT_MAX_FIELDS).flatMap((field) => {
    const path = fieldPath(field.id);
    if (path === null) return [];
    // Booleans name an item "true"/"false" in the web, so they name it here too.
    return [
      sql`CASE json_type(${column}, ${path}) WHEN 'integer' THEN json_extract(${column}, ${path}) WHEN 'real' THEN json_extract(${column}, ${path}) WHEN 'text' THEN NULLIF(json_extract(${column}, ${path}), '') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' END`,
    ];
  });
  if (candidates.length === 0) return null;
  return sql`COALESCE(${sql.join(candidates, sql`, `)}, NULL)`;
}

const LIST_FIELD_TYPES = new Set(["multiselect", "tags"]);
const BOUNDED_NUMBER_TYPES = new Set(["number", "rating", "currency"]);

/**
 * One filter as a SQL condition (#41). Three rules hold for every op, each
 * learned from the reviews before this was written:
 *
 * - **Parenthesised.** Drizzle's `and()` does not wrap raw `sql` fragments, so
 *   an `OR` inside one would escape the collection and trash conditions.
 * - **Type-guarded.** In SQLite, text sorts above every number, so a stored
 *   `"1999"` would pass `year >= 1960`; and `json_each` over a scalar yields
 *   the scalar, so a bare `"jazz"` would pass a tag test. Each op checks
 *   `json_type` first, as the sort expressions do.
 * - **Never throws.** Only paths built from the collection's own field ids
 *   reach SQL; an id that cannot be addressed is a fixed-text 400. Every
 *   `json_each` column is qualified, since it has an `id` column of its own.
 *
 * Text, url, email and image fields take no filters — search covers text.
 */
function filterCondition(filter: ItemFilter, fields: FieldDefinition[]): SQL {
  const field = fields.find((candidate) => candidate.id === filter.field);
  const path = field ? fieldPath(field.id) : null;
  if (!field || path === null) throw new InvalidItemQueryError("Unknown filter field");
  const column = schema.items.fields;
  const type = sql`json_type(${column}, ${path})`;
  const value = sql`json_extract(${column}, ${path})`;
  const isList = LIST_FIELD_TYPES.has(field.type);
  const unsupported = () => new InvalidItemQueryError("This filter does not suit this field");

  switch (filter.op) {
    case "empty": {
      if (!(isList || BOUNDED_NUMBER_TYPES.has(field.type) || ["select", "date", "boolean"].includes(field.type))) {
        throw unsupported();
      }
      return sql`(${type} IS NULL OR ${type} = 'null' OR (${type} = 'text' AND ${value} = '') OR (${type} = 'array' AND json_array_length(${column}, ${path}) = 0))`;
    }
    case "in":
    case "all": {
      const needles = JSON.stringify(filter.value);
      if (field.type === "select" && filter.op === "in") {
        // Trimmed: filter values are trimmed, and a value another client
        // stored with stray spaces is still that value.
        return sql`(${type} = 'text' AND trim(${value}) IN (SELECT "needle"."value" FROM json_each(${needles}) AS "needle"))`;
      }
      if (!isList) throw unsupported();
      // Tags are typed freely, so "Signed" and "signed" are one tag; multiselect
      // values are the schema's options, matched as stored.
      const collate = field.type === "tags" ? sql` COLLATE NOCASE` : sql``;
      const present = sql`EXISTS (SELECT 1 FROM json_each(${column}, ${path}) AS "held" WHERE "held"."type" = 'text' AND trim("held"."value") = "needle"."value"${collate})`;
      if (filter.op === "in") {
        return sql`(${type} = 'array' AND EXISTS (SELECT 1 FROM json_each(${needles}) AS "needle" WHERE ${present}))`;
      }
      return sql`(${type} = 'array' AND NOT EXISTS (SELECT 1 FROM json_each(${needles}) AS "needle" WHERE NOT ${present}))`;
    }
    case "gte":
    case "lte": {
      const compare = filter.op === "gte" ? sql`>=` : sql`<=`;
      if (BOUNDED_NUMBER_TYPES.has(field.type) && typeof filter.value === "number") {
        return sql`(${type} IN ('integer', 'real') AND ${value} ${compare} ${filter.value})`;
      }
      if (field.type === "date" && typeof filter.value === "string") {
        // By calendar day: a datetime another client stored is read as its date,
        // and text that does not start with a padded date ("1999", "2020-5-3")
        // is not one — compared as text it would pass bounds it should not.
        return sql`(${type} = 'text' AND ${value} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND substr(${value}, 1, 10) ${compare} ${filter.value})`;
      }
      throw unsupported();
    }
    case "eq": {
      if (field.type !== "boolean") throw unsupported();
      return sql`(${type} = ${filter.value ? "true" : "false"})`;
    }
  }
}

/**
 * ORDER BY terms for a sort: empty values last whichever the direction, text
 * compared case-insensitively (ASCII only — SQLite's NOCASE does not fold é),
 * and the implicit rowid as the tie-break so equal keys keep insertion order.
 */
function orderTerms(sort: ItemSort, fields: FieldDefinition[]): SQL[] {
  const dir = sort.direction === "desc" ? sql`DESC` : sql`ASC`;
  const rowid = sql`${schema.items}.rowid ${dir}`;
  if (sort.key === "createdAt") return [sql`${schema.items.createdAt} ${dir}`, rowid];
  if (sort.key === "updatedAt") return [sql`${schema.items.updatedAt} ${dir}`, rowid];

  let value: SQL | null;
  if (sort.key === "name") {
    value = nameSortValue(fields);
    if (value === null) return [rowid];
  } else {
    const { fieldId } = sort;
    const field = fields.find((candidate) => candidate.id === fieldId);
    const path = field ? fieldPath(field.id) : null;
    if (!field || path === null) throw new InvalidItemQueryError("Unknown sort field");
    value = fieldSortValue(field, path);
    if (value === null) throw new InvalidItemQueryError("This field cannot be sorted");
  }
  return [sql`(${value}) IS NULL`, sql`${value} COLLATE NOCASE ${dir}`, rowid];
}

function rowToItem(row: ItemRow): Item {
  return ItemSchema.parse({
    id: row.id,
    collectionId: row.collectionId,
    status: row.status,
    fields: JSON.parse(row.fields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    collectionId: item.collectionId,
    status: item.status,
    fields: JSON.stringify(item.fields),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

export class ItemsRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString();
    const item = ItemSchema.parse({
      id: randomUUID(),
      collectionId: input.collectionId,
      status: input.status ?? "owned",
      fields: input.fields,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    this.#db.insert(schema.items).values(itemToRow(item)).run();
    return item;
  }

  /**
   * Inserts a fully-formed item (preserving its id and timestamps) for backup
   * restore. Skips the row if an item with the same id already exists, so imports
   * are idempotent and non-destructive. Synchronous so it can participate in a
   * caller's transaction. Returns whether a row was inserted.
   */
  insertImported(item: Item): boolean {
    const validated = ItemSchema.parse(item);
    const result = this.#db.insert(schema.items).values(itemToRow(validated)).onConflictDoNothing().run();
    return result.changes > 0;
  }

  async getById(id: string, options: ReadOptions = {}): Promise<Item | null> {
    const row = this.#db.select().from(schema.items).where(eq(schema.items.id, id)).get();
    if (!row || (row.deletedAt !== null && !options.includeDeleted)) {
      return null;
    }
    return rowToItem(row);
  }

  /**
   * Counts non-deleted items grouped by collection, in a single query. Returns a
   * map of collection id -> count; collections with no items are absent (callers
   * should treat a missing key as 0).
   */
  async countByCollection(): Promise<Record<string, number>> {
    const rows = this.#db
      .select({ collectionId: schema.items.collectionId, count: sql<number>`count(*)` })
      .from(schema.items)
      .where(isNull(schema.items.deletedAt))
      .groupBy(schema.items.collectionId)
      .all();
    return Object.fromEntries(rows.map((r) => [r.collectionId, r.count]));
  }

  /**
   * Counts the items of a single collection, soft-deleted ones included. Callers
   * guarding a destructive schema change need the trash-inclusive number: a
   * trashed item can be restored, and it would come back holding values the new
   * schema can no longer read.
   */
  async countByCollectionId(collectionId: string): Promise<number> {
    const row = this.#db
      .select({ count: sql<number>`count(*)` })
      .from(schema.items)
      .where(eq(schema.items.collectionId, collectionId))
      .get();
    return row?.count ?? 0;
  }

  async listByCollection(collectionId: string, options: ListItemsOptions = {}): Promise<Item[]> {
    const conditions: SQL[] = [eq(schema.items.collectionId, collectionId)];
    if (!options.includeDeleted) {
      conditions.push(isNull(schema.items.deletedAt));
    }
    if (options.status) {
      conditions.push(eq(schema.items.status, options.status));
    }
    const match = options.q ? toMatchExpression(options.q) : null;
    if (options.filters && options.filters.length > 0) {
      const fields = this.#schemaOf(collectionId);
      for (const filter of options.filters) conditions.push(filterCondition(filter, fields));
    }

    let order: SQL[];
    if (options.sort) {
      order = orderTerms(options.sort, this.#schemaOf(collectionId));
    } else if (match !== null) {
      order = [sql`bm25(${itemsFts})`, sql`${schema.items}.rowid`];
    } else {
      order = [sql`${schema.items}.rowid`];
    }

    if (match === null) {
      const rows = this.#db
        .select()
        .from(schema.items)
        .where(and(...conditions))
        .orderBy(...order)
        .all();
      return rows.map(rowToItem);
    }
    const rows = this.#db
      .select({ item: schema.items })
      .from(schema.items)
      .innerJoin(itemsSearchKey, eq(itemsSearchKey.itemId, schema.items.id))
      .innerJoin(itemsFts, eq(itemsFts.rowid, itemsSearchKey.key))
      .where(and(...conditions, sql`${itemsFts} MATCH ${match}`))
      .orderBy(...order)
      .all();
    return rows.map((row) => rowToItem(row.item));
  }

  /**
   * The tags in use in one tags field, for suggesting them (#41): live items of
   * this collection only, counted, most used first, at most `TAG_VALUES_LIMIT`.
   * Tags compare without case, as the tag filter does, so "Signed" and "signed"
   * are one entry, shown in the spelling that sorts first. Only tags a filter
   * can ask for are suggested — trimmed, 1 to 200 characters, no control
   * characters, the rules core's filter schema applies — so every suggestion
   * finds its items.
   */
  async tagValues(collectionId: string, fieldId: string): Promise<{ values: TagValue[]; truncated: boolean }> {
    const field = this.#schemaOf(collectionId).find((candidate) => candidate.id === fieldId);
    const path = field?.type === "tags" ? fieldPath(field.id) : null;
    if (path === null) throw new InvalidItemQueryError("Not a tags field");
    const column = schema.items.fields;
    const rows = this.#db.all<{ value: string; count: number }>(sql`
      SELECT MIN(trim("held"."value")) AS "value", count(DISTINCT ${schema.items.id}) AS "count"
      FROM ${schema.items}, json_each(${column}, ${path}) AS "held"
      WHERE ${schema.items.collectionId} = ${collectionId}
        AND ${schema.items.deletedAt} IS NULL
        AND json_type(${column}, ${path}) = 'array'
        AND "held"."type" = 'text'
        AND length(trim("held"."value")) BETWEEN 1 AND ${ITEM_FILTER_MAX_VALUE_LENGTH}
        AND "held"."value" NOT GLOB ${CONTROL_CHARACTER_GLOB}
      GROUP BY trim("held"."value") COLLATE NOCASE
      ORDER BY "count" DESC, "value" COLLATE NOCASE ASC
      LIMIT ${TAG_VALUES_LIMIT + 1}
    `);
    return { values: rows.slice(0, TAG_VALUES_LIMIT), truncated: rows.length > TAG_VALUES_LIMIT };
  }

  /**
   * Rebuilds the search index from scratch. Touching every item's fields fires
   * the update trigger, which holds the one definition of what is searchable.
   */
  reindex(): void {
    this.#db.transaction((tx) => {
      tx.run(sql`DELETE FROM ${itemsFts}`);
      tx.run(sql`UPDATE ${schema.items} SET ${sql.identifier("fields")} = ${sql.identifier("fields")}`);
    });
  }

  #schemaOf(collectionId: string): FieldDefinition[] {
    const row = this.#db
      .select({ fields: schema.collections.fields })
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId))
      .get();
    return row ? (JSON.parse(row.fields) as FieldDefinition[]) : [];
  }

  /**
   * Finds non-deleted items whose custom field equals the given value, using
   * SQLite's json_extract() over the JSON fields column.
   */
  async findByFieldValue(collectionId: string, fieldId: string, value: string | number | boolean): Promise<Item[]> {
    // JSON booleans come back from json_extract() as integers.
    const compare = typeof value === "boolean" ? (value ? 1 : 0) : value;
    const path = fieldPath(fieldId);
    if (path === null) return [];
    const rows = this.#db
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.collectionId, collectionId),
          isNull(schema.items.deletedAt),
          sql`json_extract(${schema.items.fields}, ${path}) = ${compare}`,
        ),
      )
      .all();
    return rows.map(rowToItem);
  }

  /**
   * Lists soft-deleted items for the trash, most recently deleted first, each
   * carrying the name of the collection it belongs to.
   *
   * Items of a soft-deleted collection are deliberately excluded: a trashed
   * collection takes its contents down with it without stamping a single child
   * row, and restoring the collection brings them all back. Listing them here
   * would offer a restore that could only put the item back inside a collection
   * the user cannot see. Ties on `deletedAt` break on id so the order is stable.
   */
  async listDeleted(): Promise<DeletedItem[]> {
    const rows = this.#db
      .select({ item: schema.items, collectionName: schema.collections.name })
      .from(schema.items)
      .innerJoin(schema.collections, eq(schema.items.collectionId, schema.collections.id))
      .where(and(isNotNull(schema.items.deletedAt), isNull(schema.collections.deletedAt)))
      .orderBy(desc(schema.items.deletedAt), asc(schema.items.id))
      .all();
    return rows.map((row) => ({ ...rowToItem(row.item), collectionName: row.collectionName }));
  }

  async update(id: string, patch: UpdateItemInput): Promise<Item | null> {
    const existing = await this.getById(id, { includeDeleted: true });
    if (!existing) {
      return null;
    }
    const updated = ItemSchema.parse({
      ...existing,
      ...stripUndefined(patch),
      id,
      updatedAt: new Date().toISOString(),
    });
    this.#db.update(schema.items).set(itemToRow(updated)).where(eq(schema.items.id, id)).run();
    return updated;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.items)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(schema.items.id, id), isNull(schema.items.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async restore(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.items)
      .set({ deletedAt: null })
      .where(and(eq(schema.items.id, id), isNotNull(schema.items.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async hardDelete(id: string): Promise<boolean> {
    const result = this.#db.delete(schema.items).where(eq(schema.items.id, id)).run();
    return result.changes > 0;
  }

  /**
   * Permanently removes an item, but only while it is in the trash. The
   * `deletedAt` guard is part of the DELETE rather than a separate read, so a
   * restore racing a purge cannot destroy a row the user has just recovered.
   * Returns false for a live item, an unknown id, and an already-purged one.
   */
  async purge(id: string): Promise<boolean> {
    const result = this.#db
      .delete(schema.items)
      .where(and(eq(schema.items.id, id), isNotNull(schema.items.deletedAt)))
      .run();
    return result.changes > 0;
  }
}
