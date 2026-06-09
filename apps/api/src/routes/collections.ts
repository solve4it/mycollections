import type { DatabaseHandle } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

const createBodySchema = {
  type: "object",
  required: ["name", "fields", "isFiniteSet"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    fields: { type: "array", minItems: 1, items: {} },
    isFiniteSet: { type: "boolean" },
  },
} as const;

const updateBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    isFiniteSet: { type: "boolean" },
  },
} as const;

export async function registerCollectionRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/collections", async () => {
    return db.collections.list();
  });

  app.post("/api/collections", { schema: { body: createBodySchema } }, async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      fields: unknown[];
      isFiniteSet: boolean;
    };
    try {
      const collection = await db.collections.create({
        name: body.name,
        description: body.description,
        // biome-ignore lint/suspicious/noExplicitAny: validated downstream by Zod in repository
        fields: body.fields as any,
        isFiniteSet: body.isFiniteSet,
      });
      return reply.code(201).send(collection);
    } catch (err) {
      throw app.httpErrors.badRequest(err instanceof Error ? err.message : "Invalid input");
    }
  });

  app.get("/api/collections/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    return collection;
  });

  app.patch("/api/collections/:id", { schema: { body: updateBodySchema } }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; isFiniteSet?: boolean };
    const updated = await db.collections.update(id, body);
    if (!updated) throw app.httpErrors.notFound("Collection not found");
    return updated;
  });

  app.delete("/api/collections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await db.collections.softDelete(id);
    if (!deleted) throw app.httpErrors.notFound("Collection not found");
    return reply.code(204).send();
  });

  app.post("/api/collections/:id/restore", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const restored = await db.collections.restore(id);
    if (!restored) throw app.httpErrors.notFound("Collection not found or not deleted");
    return db.collections.getById(id, { includeDeleted: false });
  });
}
