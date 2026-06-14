import { ITEM_STATUSES } from "@mycollections/core";
import type { DatabaseHandle } from "@mycollections/db";
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

const statusQuerySchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ITEM_STATUSES },
  },
} as const;

export async function registerItemRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/collections/:id/items", { schema: { querystring: statusQuerySchema } }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.query as { status?: string };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    // biome-ignore lint/suspicious/noExplicitAny: status narrowed by Fastify schema enum
    return db.items.listByCollection(id, { status: status as any });
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
    // biome-ignore lint/suspicious/noExplicitAny: narrowed by schema enum
    const updated = await db.items.update(itemId, { status: body.status as any, fields: body.fields });
    if (!updated || updated.collectionId !== id) throw app.httpErrors.notFound("Item not found");
    return updated;
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
