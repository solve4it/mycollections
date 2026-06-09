import { randomUUID } from "node:crypto";
import { type Media, MediaSchema } from "@mycollections/core";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import type { ReadOptions } from "./collections.js";

type Db = BetterSQLite3Database<typeof schema>;
type MediaRow = typeof schema.media.$inferSelect;
type MediaKind = Media["kind"];

export interface CreateMediaInput {
  itemId: string;
  kind: MediaKind;
  mimeType: string;
  bytes: number;
  isPrimary?: boolean;
  storagePath?: string;
}

function rowToMedia(row: MediaRow): Media {
  return MediaSchema.parse({
    id: row.id,
    itemId: row.itemId,
    kind: row.kind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    isPrimary: row.isPrimary,
    storagePath: row.storagePath ?? undefined,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  });
}

function mediaToRow(media: Media): MediaRow {
  return {
    id: media.id,
    itemId: media.itemId,
    kind: media.kind,
    mimeType: media.mimeType,
    bytes: media.bytes,
    isPrimary: media.isPrimary,
    storagePath: media.storagePath ?? null,
    createdAt: media.createdAt,
    deletedAt: media.deletedAt,
  };
}

export class MediaRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async create(input: CreateMediaInput): Promise<Media> {
    const media = MediaSchema.parse({
      id: randomUUID(),
      itemId: input.itemId,
      kind: input.kind,
      mimeType: input.mimeType,
      bytes: input.bytes,
      isPrimary: input.isPrimary ?? false,
      storagePath: input.storagePath,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    });
    this.#db.transaction((tx) => {
      if (media.isPrimary) {
        tx.update(schema.media).set({ isPrimary: false }).where(eq(schema.media.itemId, media.itemId)).run();
      }
      tx.insert(schema.media).values(mediaToRow(media)).run();
    });
    return media;
  }

  async getById(id: string, options: ReadOptions = {}): Promise<Media | null> {
    const row = this.#db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || (row.deletedAt !== null && !options.includeDeleted)) {
      return null;
    }
    return rowToMedia(row);
  }

  async listByItem(itemId: string, options: ReadOptions = {}): Promise<Media[]> {
    const conditions = [eq(schema.media.itemId, itemId)];
    if (!options.includeDeleted) {
      conditions.push(isNull(schema.media.deletedAt));
    }
    const rows = this.#db
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .all();
    return rows.map(rowToMedia);
  }

  /** Makes this media the item's primary image, demoting any current primary. */
  async setPrimary(id: string): Promise<boolean> {
    const row = this.#db.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row) {
      return false;
    }
    this.#db.transaction((tx) => {
      tx.update(schema.media).set({ isPrimary: false }).where(eq(schema.media.itemId, row.itemId)).run();
      tx.update(schema.media).set({ isPrimary: true }).where(eq(schema.media.id, id)).run();
    });
    return true;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.media)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(schema.media.id, id), isNull(schema.media.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async restore(id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.media)
      .set({ deletedAt: null })
      .where(and(eq(schema.media.id, id), isNotNull(schema.media.deletedAt)))
      .run();
    return result.changes > 0;
  }

  async hardDelete(id: string): Promise<boolean> {
    const result = this.#db.delete(schema.media).where(eq(schema.media.id, id)).run();
    return result.changes > 0;
  }
}
