import { ITEM_SEARCH_MAX_LENGTH, ITEM_STATUSES, type ItemSort, parseItemSort } from "@mycollections/core";
import { type DatabaseHandle, InvalidItemQueryError } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

const createBodySchema = {
  type: "object",
  required: ["fields"],
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ITEM_STATUSES },
    fields: { type: "object" },
  },
} as const;

const updateBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ITEM_STATUSES },
    fields: { type: "object" },
  },
} as const;

/**
 * Query for listing items. `q` and `sort` are single strings: a repeated key
 * arrives as an array and fails validation rather than one value silently
 * winning. Both carry collection data, so the request logger strips the whole
 * query string (see logger.ts).
 */
const listQuerySchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ITEM_STATUSES },
    q: { type: "string", maxLength: ITEM_SEARCH_MAX_LENGTH },
    // A field id is free text, so allow room for one beyond the `-field:` prefix.
    sort: { type: "string", minLength: 1, maxLength: 300 },
  },
} as const;

export async function registerItemRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/collections/:id/items", { schema: { querystring: listQuerySchema } }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { status?: string; q?: string; sort?: string };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    let sort: ItemSort | undefined;
    if (query.sort !== undefined) {
      const parsed = parseItemSort(query.sort);
      // Fixed text: the sort key may be a field id, which is collection data.
      if (!parsed) throw app.httpErrors.badRequest("Invalid sort");
      sort = parsed;
    }
    try {
      // biome-ignore lint/suspicious/noExplicitAny: status narrowed by Fastify schema enum
      return await db.items.listByCollection(id, { status: query.status as any, q: query.q, sort });
    } catch (err) {
      // InvalidItemQueryError messages are fixed text; anything else is a 500.
      if (err instanceof InvalidItemQueryError) throw app.httpErrors.badRequest(err.message);
      throw err;
    }
  });

  app.post("/api/collections/:id/items", { schema: { body: createBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; fields: Record<string, unknown> };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    try {
      const item = await db.items.create({
        collectionId: id,
        // biome-ignore lint/suspicious/noExplicitAny: narrowed by schema enum
        status: body.status as any,
        fields: body.fields,
      });
      return reply.code(201).send(item);
    } catch (err) {
      throw app.httpErrors.badRequest(err instanceof Error ? err.message : "Invalid input");
    }
  });

  app.get("/api/collections/:id/items/:itemId", async (request, _reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    const item = await db.items.getById(itemId);
    if (!item || item.collectionId !== id) throw app.httpErrors.notFound("Item not found");
    return item;
  });

  app.patch("/api/collections/:id/items/:itemId", { schema: { body: updateBodySchema } }, async (request, _reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const body = request.body as { status?: string; fields?: Record<string, unknown> };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    // Ownership must be checked before the update runs — a 404 must never
    // leave a side effect behind (an item is only reachable via its own collection).
    const existing = await db.items.getById(itemId);
    if (!existing || existing.collectionId !== id) throw app.httpErrors.notFound("Item not found");
    // biome-ignore lint/suspicious/noExplicitAny: narrowed by schema enum
    const updated = await db.items.update(itemId, { status: body.status as any, fields: body.fields });
    if (!updated) throw app.httpErrors.notFound("Item not found");
    return updated;
  });

  app.post("/api/collections/:id/items/:itemId/restore", async (request, _reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    // A trashed collection is unreachable here, which is the cascade rule doing its
    // job: while the parent is in the trash its items come back with it, never one
    // at a time into a collection the user cannot see.
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    const existing = await db.items.getById(itemId, { includeDeleted: true });
    if (!existing || existing.collectionId !== id) throw app.httpErrors.notFound("Item not found");
    const restored = await db.items.restore(itemId);
    if (!restored) throw app.httpErrors.notFound("Item not found in trash");
    return db.items.getById(itemId);
  });

  app.delete("/api/collections/:id/items/:itemId", async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    const existing = await db.items.getById(itemId);
    if (!existing || existing.collectionId !== id) throw app.httpErrors.notFound("Item not found");
    await db.items.softDelete(itemId);
    return reply.code(204).send();
  });
}
