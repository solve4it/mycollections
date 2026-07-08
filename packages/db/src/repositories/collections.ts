import { randomUUID } from "node:crypto";
import { type Collection, CollectionSchema, type FieldDefinition } from "@mycollections/core";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { stripUndefined } from "./strip-undefined.js";

type Db = BetterSQLite3Database<typeof schema>;
type CollectionRow = typeof schema.collections.$inferSelect;

export interface CreateCollectionInput {
  name: string;
  description?: string;
  fields: FieldDefinition[];
  isFiniteSet: boolean;
}

export type UpdateCollectionInput = Partial<CreateCollectionInput>;

export interface ReadOptions {
  includeDeleted?: boolean;
}

function rowToCollection(row: CollectionRow): Collection {
  return CollectionSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    fields: JSON.parse(row.fields),
    isFiniteSet: row.isFiniteSet,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

function collectionToRow(collection: Collection): CollectionRow {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description ?? null,
    fields: JSON.stringify(collection.fields),
    isFiniteSet: collection.isFiniteSet,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    deletedAt: collection.deletedAt,
  };
}

export class CollectionsRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async create(input: CreateCollectionInput): Promise<Collection> {
    const now = new Date().toISOString();
    const collection = CollectionSchema.parse({
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    this.#db.insert(schema.collections).values(collectionToRow(collection)).run();
    return collection;
  }

  /**
   * Inserts a fully-formed collection (preserving its id and timestamps) for
   * backup restore. Skips the row if a collection with the same id already
   * exists, so imports are idempotent and non-destructive. Synchronous so it can
   * participate in a caller's transaction. Returns whether a row was inserted.
   */
  insertImported(collection: Collection): boolean {
    const validated = CollectionSchema.parse(collection);
    const result = this.#db.insert(schema.collections).values(collectionToRow(validated)).onConflictDoNothing().run();
    return result.changes > 0;
  }

  async getById(id: string, options: ReadOptions = {}): Promise<Collection | null> {
    const row = this.#db.select().from(schema.collections).where(eq(schema.collections.id, id)).get();
    if (!row || (row.deletedAt !== null && !options.includeDeleted)) {
      return null;
    }
    return rowToCollection(row);
  }

  async list(options: ReadOptions = {}): Promise<Collection[]> {
    const query = this.#db.select().from(schema.collections);
    const rows = options.includeDeleted ? query.all() : query.where(isNull(schema.collections.deletedAt)).all();
    return rows.map(rowToCollection);
  }

  async update(id: string, patch: UpdateCollectionInput): Promise<Collection | null> {
    const existing = await this.getById(id, { includeDeleted: true });
    if (!existing) {
      return null;
    }
    const updated = CollectionSchema.parse({
      ...existing,
      ...stripUndefined(patch),
      id,
      updatedAt: new Date().toISOString(),
    });
    this.#db.update(schema.collections).set(collectionToRow(updated)).where(eq(schema.collections.id, id)).run();
    return updated;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.collections)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(schema.collections.id, id), isNull(schema.collections.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async restore(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.collections)
      .set({ deletedAt: null })
      .where(and(eq(schema.collections.id, id), isNotNull(schema.collections.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async hardDelete(id: string): Promise<boolean> {
    const result = this.#db.delete(schema.collections).where(eq(schema.collections.id, id)).run();
    return result.changes > 0;
  }
}
