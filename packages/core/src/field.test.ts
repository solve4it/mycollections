import { describe, expect, it } from "vitest";
import { BUILT_IN_FIELD_TYPES, FieldDefinitionSchema } from "./field.js";

describe("BUILT_IN_FIELD_TYPES", () => {
  it("covers the 12 built-in types", () => {
    expect(BUILT_IN_FIELD_TYPES).toEqual([
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
    ]);
  });
});

describe("FieldDefinitionSchema", () => {
  it("validates a minimal text field", () => {
    const field = FieldDefinitionSchema.parse({
      id: "title",
      label: "Title",
      type: "text",
    });
    expect(field.id).toBe("title");
    expect(field.required).toBe(false);
  });

  it("requires options on select fields", () => {
    expect(() =>
      FieldDefinitionSchema.parse({
        id: "genre",
        label: "Genre",
        type: "select",
      }),
    ).toThrow();
  });

  it("accepts a select field with options", () => {
    const field = FieldDefinitionSchema.parse({
      id: "genre",
      label: "Genre",
      type: "select",
      options: ["rock", "jazz"],
    });
    expect(field.type).toBe("select");
  });

  it("accepts a multiselect field with options", () => {
    const field = FieldDefinitionSchema.parse({
      id: "tags",
      label: "Tags",
      type: "multiselect",
      options: ["a", "b"],
    });
    expect(field.type).toBe("multiselect");
  });

  it("accepts a rating field with max", () => {
    const field = FieldDefinitionSchema.parse({
      id: "rating",
      label: "Rating",
      type: "rating",
      max: 5,
    });
    expect(field.type).toBe("rating");
  });

  it("rejects empty id", () => {
    expect(() => FieldDefinitionSchema.parse({ id: "", label: "X", type: "text" })).toThrow();
  });

  it("rejects unknown field type", () => {
    expect(() => FieldDefinitionSchema.parse({ id: "x", label: "X", type: "blob" })).toThrow();
  });
});
