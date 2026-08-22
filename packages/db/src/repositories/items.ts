import { randomUUID } from "node:crypto";
import { type DeletedItem, type Item, ItemSchema, type ItemStatus } from "@mycollections/core";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
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
    const conditions = [eq(schema.items.collectionId, collectionId)];
    if (!options.includeDeleted) {
      conditions.push(isNull(schema.items.deletedAt));
    }
    if (options.status) {
      conditions.push(eq(schema.items.status, options.status));
    }
    const rows = this.#db
      .select()
      .from(schema.items)
      .where(and(...conditions))
      .all();
    return rows.map(rowToItem);
  }

  /**
   * Finds non-deleted items whose custom field equals the given value, using
   * SQLite's json_extract() over the JSON fields column.
   */
  async findByFieldValue(collectionId: string, fieldId: string, value: string | number | boolean): Promise<Item[]> {
    // JSON booleans come back from json_extract() as integers.
    const compare = typeof value === "boolean" ? (value ? 1 : 0) : value;
    // The field id is embedded in a JSON path string literal, so escape per JSON string rules.
    const escaped = fieldId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const path = `$."${escaped}"`;
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
