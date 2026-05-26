import { z } from "zod";
import { FieldDefinitionSchema } from "./field.js";

export const CollectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    fields: z.array(FieldDefinitionSchema).min(1),
    isFiniteSet: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable().default(null),
  })
  .refine((c) => new Set(c.fields.map((f) => f.id)).size === c.fields.length, {
    message: "field ids must be unique",
    path: ["fields"],
  });

export type Collection = z.infer<typeof CollectionSchema>;
