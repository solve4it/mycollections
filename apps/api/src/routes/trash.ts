import { type DatabaseHandle, emptyTrash } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

/**
 * The trash: what soft delete has hidden, and the two ways out of it —
 * restore (resource-scoped, beside the resource itself) and purge.
 *
 * Permanent deletion lives here rather than as a flag on the ordinary DELETE
 * routes so that destroying data is a different request to a different path,
 * never a query parameter away from an everyday delete.
 */
export async function registerTrashRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/trash", async () => {
    const [collections, items] = await Promise.all([db.collections.listDeleted(), db.items.listDeleted()]);
    return { collections, items };
  });

  // Emptying the trash is the one action in the app that nothing can undo, so it
  // answers with what it removed rather than a bare 204 — the caller needs those
  // counts to tell the user what just happened.
  app.delete("/api/trash", async () => emptyTrash(db));

  app.delete("/api/trash/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    // `purge` is a no-op on anything that is not in the trash, so a live item
    // answers 404 without the read-then-write window a separate check would open.
    const purged = await db.items.purge(itemId);
    if (!purged) throw app.httpErrors.notFound("Item not found in trash");
    return reply.code(204).send();
  });

  app.delete("/api/trash/collections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purged = await db.collections.purge(id);
    if (!purged) throw app.httpErrors.notFound("Collection not found in trash");
    return reply.code(204).send();
  });
}
