import { isNotNull } from "drizzle-orm";
import type { DatabaseHandle } from "./open-database.js";
import * as schema from "./schema.js";

export interface EmptyTrashResult {
  /** Items removed on their own. Items taken by a collection's cascade are not counted here. */
  items: number;
  collections: number;
}

/**
 * Permanently removes everything in the trash: every soft-deleted collection
 * (and, by foreign key cascade, everything inside it) and every soft-deleted
 * item. Live rows are never touched.
 *
 * Collections go first so that an item which was deleted individually *and*
 * whose collection was later deleted is removed once, by the cascade, rather
 * than counted as two deletions of one row.
 *
 * The whole thing runs in one transaction: emptying the trash either happens or
 * does not, never half of it, so a failure part-way cannot leave a collection
 * gone with its items still on disk.
 */
export async function emptyTrash(handle: DatabaseHandle): Promise<EmptyTrashResult> {
  return handle.db.transaction((tx) => {
    const collections = tx.delete(schema.collections).where(isNotNull(schema.collections.deletedAt)).run();
    const items = tx.delete(schema.items).where(isNotNull(schema.items.deletedAt)).run();
    return { items: items.changes, collections: collections.changes };
  });
}
