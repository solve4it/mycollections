import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Phase 1 tables only. Later phases add their own tables via new migrations:
 * share_links (#48), plugin_data (#54/#55), licenses (#57),
 * mutations/sync_state (#49), items_fts (#41).
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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const items = sqliteTable("items", {
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
});

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  bytes: integer("bytes").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull(),
  storagePath: text("storage_path"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

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
