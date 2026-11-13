import { type DatabaseHandle, emptyTrash } from "@mycollections/db";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { MediaStore } from "../media/media-store.js";

/**
 * The trash: what soft delete has hidden, and the two ways out of it —
 * restore (resource-scoped, beside the resource itself) and purge.
 *
 * Permanent deletion lives here rather than as a flag on the ordinary DELETE
 * routes so that destroying data is a different request to a different path,
 * never a query parameter away from an everyday delete.
 */
export async function registerTrashRoutes(app: FastifyInstance, db: DatabaseHandle, media?: MediaStore) {
  /**
   * Runs a purge and then removes the files of every image row it took (#37) —
   * by cascade from an item or a collection, or a trashed image emptied with the
   * trash. Diffed from the rows before and after rather than predicted, so a
   * purge that took less than expected removes no more than it took, and an
   * image uploaded meanwhile (absent from "before") is never touched.
   *
   * Removing files runs after the commit and cannot undo it: a file that will
   * not go is logged and left for the startup sweep, and the request still
   * succeeds, because the data it asked to destroy is gone.
   */
  async function purgeRemovingFiles<T>(log: FastifyBaseLogger, purge: () => Promise<T>): Promise<T> {
    if (!media) return purge();
    const before = await db.media.listFileRefs();
    const result = await purge();
    const after = new Set((await db.media.listFileRefs()).map((ref) => ref.id));
    for (const ref of before) {
      if (after.has(ref.id)) continue;
      await media.remove(ref.itemId, ref.id).catch((err) => log.warn({ err }, "could not remove an image file"));
    }
    return result;
  }

  app.get("/api/trash", async () => {
    const [collections, items] = await Promise.all([db.collections.listDeleted(), db.items.listDeleted()]);
    return { collections, items };
  });

  // Emptying the trash is the one action in the app that nothing can undo, so it
  // answers with what it removed rather than a bare 204 — the caller needs those
  // counts to tell the user what just happened.
  app.delete("/api/trash", async (request) => purgeRemovingFiles(request.log, () => emptyTrash(db)));

  app.delete("/api/trash/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    // `purge` is a no-op on anything that is not in the trash, so a live item
    // answers 404 without the read-then-write window a separate check would open.
    const purged = await purgeRemovingFiles(request.log, () => db.items.purge(itemId));
    if (!purged) throw app.httpErrors.notFound("Item not found in trash");
    return reply.code(204).send();
  });

  app.delete("/api/trash/collections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purged = await purgeRemovingFiles(request.log, () => db.collections.purge(id));
    if (!purged) throw app.httpErrors.notFound("Collection not found in trash");
    return reply.code(204).send();
  });
}
