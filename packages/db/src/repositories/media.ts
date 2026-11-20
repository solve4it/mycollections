import { randomUUID } from "node:crypto";
import { type Media, MediaSchema, type MediaSource } from "@mycollections/core";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import type { ReadOptions } from "./collections.js";

type Db = BetterSQLite3Database<typeof schema>;
type MediaRow = typeof schema.media.$inferSelect;

export interface CreateMediaInput {
  /**
   * Chosen by the caller when the files have to exist before the row does: the
   * API writes `<itemId>/<id>.webp` first and inserts only once both files are
   * on disk, so a row never names files that are not there.
   */
  id?: string;
  itemId: string;
  source: MediaSource;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
}

/** The ids that place one row's files on disk: `<MEDIA_DIR>/<itemId>/<id>…`. */
export interface MediaFileRef {
  itemId: string;
  id: string;
}

function rowToMedia(row: MediaRow): Media {
  return MediaSchema.parse(row);
}

/**
 * Images attached to an item (#37).
 *
 * Every write that names a media id also names its item, and matches on both:
 * a media id reached through the wrong item is "not found" and changes nothing,
 * rather than acting on whatever item the id happens to belong to. The API
 * checks the collection above that.
 *
 * The primary is the live image with the lowest position; see the schema.
 */
export class MediaRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Appends after every image the item has ever had that is still stored, trashed ones included. */
  async create(input: CreateMediaInput): Promise<Media> {
    return this.#db.transaction((tx) => {
      const last = tx
        .select({ max: sql<number | null>`max(${schema.media.position})` })
        .from(schema.media)
        .where(eq(schema.media.itemId, input.itemId))
        .get();
      const media = MediaSchema.parse({
        id: input.id ?? randomUUID(),
        itemId: input.itemId,
        kind: "image",
        source: input.source,
        mimeType: input.mimeType,
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        position: (last?.max ?? -1) + 1,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      });
      tx.insert(schema.media).values(media).run();
      return media;
    });
  }

  async getForItem(itemId: string, id: string, options: ReadOptions = {}): Promise<Media | null> {
    const row = this.#db
      .select()
      .from(schema.media)
      .where(and(eq(schema.media.id, id), eq(schema.media.itemId, itemId)))
      .get();
    if (!row || (row.deletedAt !== null && !options.includeDeleted)) return null;
    return rowToMedia(row);
  }

  /** In display order: the first is the primary. */
  async listByItem(itemId: string, options: ReadOptions = {}): Promise<Media[]> {
    const conditions = [eq(schema.media.itemId, itemId)];
    if (!options.includeDeleted) conditions.push(isNull(schema.media.deletedAt));
    return this.#db
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(asc(schema.media.position), asc(schema.media.createdAt))
      .all()
      .map(rowToMedia);
  }

  /**
   * Every row of these items, trashed ones included, for an export (#45). In
   * display order per item. Queried in chunks so a large collection stays under
   * SQLite's bound-parameter limit.
   */
  async listForItems(itemIds: readonly string[]): Promise<Media[]> {
    const rows: MediaRow[] = [];
    for (const ids of chunks(itemIds)) {
      rows.push(
        ...this.#db
          .select()
          .from(schema.media)
          .where(inArray(schema.media.itemId, ids))
          .orderBy(asc(schema.media.itemId), asc(schema.media.position), asc(schema.media.createdAt))
          .all(),
      );
    }
    return rows.map(rowToMedia);
  }

  /** Which of these ids already name a row, under any item. */
  existingIds(ids: readonly string[]): Set<string> {
    const found = new Set<string>();
    for (const chunk of chunks(ids)) {
      for (const row of this.#db
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(inArray(schema.media.id, chunk))
        .all()) {
        found.add(row.id);
      }
    }
    return found;
  }

  /**
   * Inserts a row from a backup exactly as it was — position, source, trash and
   * all — unlike `create`, which appends. False when the id is already taken, in
   * which case nothing changes. The caller must have written the files first.
   */
  insertImported(media: Media): boolean {
    const validated = MediaSchema.parse(media);
    return this.#db.insert(schema.media).values(validated).onConflictDoNothing().run().changes > 0;
  }

  /** Each item's live image count; items with none are left out (#453). */
  liveCounts(itemIds: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const chunk of chunks(itemIds)) {
      for (const row of this.#db
        .select({ itemId: schema.media.itemId, n: sql<number>`count(*)` })
        .from(schema.media)
        .where(and(inArray(schema.media.itemId, chunk), isNull(schema.media.deletedAt)))
        .groupBy(schema.media.itemId)
        .all()) {
        counts.set(row.itemId, row.n);
      }
    }
    return counts;
  }

  /**
   * Adds a backup's image to an item that already exists (#453). Unlike
   * `insertImported` it takes a fresh position after every row the item has,
   * trashed ones included — the archive's position would collide with the
   * item's own images — so nothing already there is reordered. Synchronous, so
   * the count and the insert share the caller's transaction.
   *
   * False, writing nothing, when the item already holds `maxLive` live images.
   * Throws when the id is taken: the caller planned it as free, and its
   * transaction must roll back rather than half-apply.
   */
  insertAttached(media: Media, maxLive: number): boolean {
    const live =
      this.#db
        .select({ n: sql<number>`count(*)` })
        .from(schema.media)
        .where(and(eq(schema.media.itemId, media.itemId), isNull(schema.media.deletedAt)))
        .get()?.n ?? 0;
    if (live >= maxLive) return false;
    const last = this.#db
      .select({ max: sql<number | null>`max(${schema.media.position})` })
      .from(schema.media)
      .where(eq(schema.media.itemId, media.itemId))
      .get();
    const validated = MediaSchema.parse({ ...media, position: (last?.max ?? -1) + 1 });
    this.#db.insert(schema.media).values(validated).run();
    return true;
  }

  async countLive(itemId: string): Promise<number> {
    const row = this.#db
      .select({ n: sql<number>`count(*)` })
      .from(schema.media)
      .where(and(eq(schema.media.itemId, itemId), isNull(schema.media.deletedAt)))
      .get();
    return row?.n ?? 0;
  }

  /**
   * Puts the item's live images in exactly the order given. Refused, writing
   * nothing, unless `ids` names every live image of the item once and nothing
   * else — a stale client list (an image added or removed in another tab) must
   * not half-apply.
   */
  async reorder(itemId: string, ids: readonly string[]): Promise<boolean> {
    return this.#db.transaction((tx) => {
      const live = tx
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(and(eq(schema.media.itemId, itemId), isNull(schema.media.deletedAt)))
        .all()
        .map((row) => row.id);
      const wanted = new Set(ids);
      if (wanted.size !== ids.length || ids.length !== live.length || !live.every((id) => wanted.has(id))) {
        return false;
      }
      ids.forEach((id, position) => {
        tx.update(schema.media).set({ position }).where(eq(schema.media.id, id)).run();
      });
      return true;
    });
  }

  /** Makes an image the primary, keeping the others in their order. */
  async moveToFront(itemId: string, id: string): Promise<boolean> {
    const live = await this.listByItem(itemId);
    if (!live.some((media) => media.id === id)) return false;
    return this.reorder(itemId, [id, ...live.filter((media) => media.id !== id).map((media) => media.id)]);
  }

  /** Keeps its position, so a restore puts it back where it was. */
  async softDelete(itemId: string, id: string): Promise<boolean> {
    const result = this.#db
      .update(schema.media)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(schema.media.id, id), eq(schema.media.itemId, itemId), isNull(schema.media.deletedAt)))
      .run();
    return result.changes > 0;
  }

  /**
   * Back into its old slot, moving every live image at or after that slot one
   * along — after a reorder another image may have been numbered into it, and
   * two images sharing a position would order by accident.
   */
  async restore(itemId: string, id: string): Promise<boolean> {
    return this.#db.transaction((tx) => {
      const row = tx
        .select()
        .from(schema.media)
        .where(and(eq(schema.media.id, id), eq(schema.media.itemId, itemId), isNotNull(schema.media.deletedAt)))
        .get();
      if (!row) return false;
      tx.update(schema.media)
        .set({ position: sql`${schema.media.position} + 1` })
        .where(
          and(
            eq(schema.media.itemId, itemId),
            isNull(schema.media.deletedAt),
            gte(schema.media.position, row.position),
          ),
        )
        .run();
      tx.update(schema.media).set({ deletedAt: null }).where(eq(schema.media.id, id)).run();
      return true;
    });
  }

  /** Each item's primary — its first live image — for the items that have one. */
  async primaryForItems(itemIds: readonly string[]): Promise<Map<string, Media>> {
    const primaries = new Map<string, Media>();
    if (itemIds.length === 0) return primaries;
    const rows = this.#db
      .select()
      .from(schema.media)
      .where(and(inArray(schema.media.itemId, [...itemIds]), isNull(schema.media.deletedAt)))
      .orderBy(asc(schema.media.itemId), asc(schema.media.position), asc(schema.media.createdAt))
      .all();
    for (const row of rows) {
      if (!primaries.has(row.itemId)) primaries.set(row.itemId, rowToMedia(row));
    }
    return primaries;
  }

  /**
   * Every row whose files must stay on disk, trashed ones included. Anything
   * under the media directory that is not named here is an orphan — the files
   * of a purged item, a crash between a commit and an unlink, a database
   * restored from a backup — and the API's sweep removes it.
   */
  async listFileRefs(): Promise<MediaFileRef[]> {
    return this.#db.select({ itemId: schema.media.itemId, id: schema.media.id }).from(schema.media).all();
  }
}

/** SQLite binds at most 32766 parameters; stay far below it. */
const CHUNK_SIZE = 500;

function* chunks<T>(values: readonly T[]): Generator<T[]> {
  for (let start = 0; start < values.length; start += CHUNK_SIZE) {
    yield values.slice(start, start + CHUNK_SIZE);
  }
}
