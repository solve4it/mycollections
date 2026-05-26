import { z } from "zod";

export const BUILT_IN_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "url",
  "email",
  "select",
  "multiselect",
  "rating",
  "currency",
  "image",
  "tags",
] as const;

export type BuiltInFieldType = (typeof BUILT_IN_FIELD_TYPES)[number];

const fieldBase = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(false),
  helpText: z.string().optional(),
});

const simpleField = (type: Exclude<BuiltInFieldType, "select" | "multiselect" | "rating" | "currency">) =>
  fieldBase.extend({ type: z.literal(type) });

const SelectField = fieldBase.extend({
  type: z.literal("select"),
  options: z.array(z.string().min(1)).min(1),
});

const MultiselectField = fieldBase.extend({
  type: z.literal("multiselect"),
  options: z.array(z.string().min(1)).min(1),
});

const RatingField = fieldBase.extend({
  type: z.literal("rating"),
  max: z.number().int().positive().default(5),
});

const CurrencyField = fieldBase.extend({
  type: z.literal("currency"),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, "ISO 4217 currency code")
    .default("USD"),
});

export const FieldDefinitionSchema = z.discriminatedUnion("type", [
  simpleField("text"),
  simpleField("number"),
  simpleField("boolean"),
  simpleField("date"),
  simpleField("url"),
  simpleField("email"),
  SelectField,
  MultiselectField,
  RatingField,
  CurrencyField,
  simpleField("image"),
  simpleField("tags"),
]);

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;
