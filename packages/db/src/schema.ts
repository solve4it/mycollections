import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Phase 1 tables only. Later phases add their own tables via new migrations:
 * share_links (#48), plugin_data (#54/#55), licenses (#57),
 * mutations/sync_state (#49).
 *
 * items_fts (#41) is a hand-written FTS5 migration (drizzle/0001_items_fts.sql):
 * drizzle-kit cannot express virtual tables or triggers, so it is deliberately
 * absent here. Never run `drizzle-kit push`/`pull` against a real database —
 * they diff against the live schema and would drop the index and its triggers.
 *
 * Timestamps are ISO 8601 strings to match the core Zod schemas. Custom field
 * values live in JSON text columns queryable with json_extract().
 */

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON array of FieldDefinition. */
  fields: text("fields").notNull(),
  isFiniteSet: integer("is_finite_set", { mode: "boolean" }).notNull(),
  /**
   * How many items complete a finite set (#42); null when unknown or not a finite
   * set. Deliberately no check(): SQLite cannot add a CHECK constraint without
   * rebuilding the table, and the repository already normalizes every read.
   */
  targetCount: integer("target_count"),
  /**
   * How the collection's page lays out its items (#38): "list" or "grid". Not
   * null with a default, so the migration that adds it fills every existing row
   * and no table rebuild is needed. No check(), for the same reason as above —
   * the repository reads anything else as "list".
   */
  itemView: text("item_view").notNull().default("list"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    /** JSON object mapping field id -> value, queryable with json_extract(). */
    fields: text("fields").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("items_collection_id_idx").on(table.collectionId, table.deletedAt)],
);

/**
 * Images attached to an item (#37). The item's primary is the live row with the
 * lowest `position`; there is no flag that could name two. Files are not
 * referenced from here: they live at `<MEDIA_DIR>/<item_id>/<id>…`, derived from
 * the ids, so moving the media directory breaks no row.
 *
 * Soft-deleted rows keep their `position`, so an Undo puts the image back where
 * it was; the order only ever compares positions, so the gap is harmless.
 */
export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("media_item_id_idx").on(table.itemId, table.deletedAt, table.position)],
);

export const userProfile = sqliteTable(
  "user_profile",
  {
    /** Opaque account key from the auth layer (e.g. `${providerId}:${sub}`). */
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    provider: text("provider").notNull(),
    /** JSON object for user preferences (theme, locale, opt-outs, ...). */
    settings: text("settings").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("user_profile_email_idx").on(table.email)],
);
