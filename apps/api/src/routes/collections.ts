import type { Collection, FieldDefinition } from "@mycollections/core";
import type { DatabaseHandle, UpdateCollectionInput } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

/**
 * `targetCount` (#42) is declared with an empty schema so Zod alone decides it.
 * Fastify's Ajv coerces types, so `{ type: "integer" }` would turn `"5"` into 5,
 * `true` into 1 and `""` into 0 — accepting what the client never meant. Declared
 * at all, it also survives `removeAdditional`, which would otherwise drop it
 * without a word. The same idiom as `fields: { items: {} }`.
 */
const targetCountSchema = {} as const;

const createBodySchema = {
  type: "object",
  required: ["name", "fields", "isFiniteSet"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    fields: { type: "array", minItems: 1, items: {} },
    isFiniteSet: { type: "boolean" },
    targetCount: targetCountSchema,
  },
} as const;

const updateBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    isFiniteSet: { type: "boolean" },
    targetCount: targetCountSchema,
    fields: { type: "array", minItems: 1, items: {} },
  },
} as const;

/**
 * The ids whose field type the patch changes. Item values are stored keyed by
 * field id and are never coerced, so retyping a field that already has values
 * would leave them unreadable by the new control — the route refuses that while
 * the collection holds items. Every other schema edit is safe: adding, removing,
 * relabelling and reordering all leave stored values exactly where they are.
 */
function retypedFieldIds(existing: FieldDefinition[], incoming: readonly unknown[]): string[] {
  const previousTypes = new Map(existing.map((field) => [field.id, field.type]));
  const changed: string[] = [];
  for (const field of incoming) {
    if (typeof field !== "object" || field === null) continue;
    const { id, type } = field as { id?: unknown; type?: unknown };
    if (typeof id !== "string" || typeof type !== "string") continue;
    const previous = previousTypes.get(id);
    if (previous !== undefined && previous !== type) changed.push(id);
  }
  return changed;
}

export async function registerCollectionRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/collections", async () => {
    const [collections, counts] = await Promise.all([db.collections.list(), db.items.countByCollection()]);
    return collections.map((collection) => ({ ...collection, itemCount: counts[collection.id] ?? 0 }));
  });

  app.post("/api/collections", { schema: { body: createBodySchema } }, async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      fields: unknown[];
      isFiniteSet: boolean;
      targetCount?: unknown;
    };
    try {
      const collection = await db.collections.create({
        name: body.name,
        description: body.description,
        // biome-ignore lint/suspicious/noExplicitAny: validated downstream by Zod in repository
        fields: body.fields as any,
        isFiniteSet: body.isFiniteSet,
        // Validated downstream by Zod in the repository; absent stays absent.
        targetCount: body.targetCount as number | null | undefined,
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
    const body = request.body as {
      name?: string;
      description?: string;
      isFiniteSet?: boolean;
      targetCount?: unknown;
      fields?: unknown[];
    };

    // Read before writing: a rejected patch must leave no trace, so the
    // existence check and the retype guard both run ahead of the update.
    const existing = await db.collections.getById(id, { includeDeleted: true });
    if (!existing) throw app.httpErrors.notFound("Collection not found");

    if (body.fields) {
      const retyped = retypedFieldIds(existing.fields, body.fields);
      if (retyped.length > 0 && (await db.items.countByCollectionId(id)) > 0) {
        throw app.httpErrors.badRequest(
          `Cannot change the type of ${retyped.join(", ")} while the collection holds items`,
        );
      }
    }

    let updated: Collection | null;
    try {
      // Fastify has already dropped keys the client did not send, so casting the
      // body whole cannot introduce an explicit `undefined` that would clobber a
      // stored value. Field definitions and targetCount are validated downstream by
      // Zod, which also refuses a target on a collection that is not a finite set
      // before anything is written.
      updated = await db.collections.update(id, body as UpdateCollectionInput);
    } catch (err) {
      throw app.httpErrors.badRequest(err instanceof Error ? err.message : "Invalid input");
    }
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
