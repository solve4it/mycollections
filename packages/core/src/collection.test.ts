import { describe, expect, it } from "vitest";
import { CollectionSchema } from "./collection.js";

const baseCollection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Records",
  fields: [{ id: "title", label: "Title", type: "text" }],
  isFiniteSet: false,
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("CollectionSchema", () => {
  it("parses a valid collection", () => {
    const parsed = CollectionSchema.parse(baseCollection);
    expect(parsed.name).toBe("Records");
    expect(parsed.isFiniteSet).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, name: "" })).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, id: "nope" })).toThrow();
  });

  it("rejects an empty fields array", () => {
    expect(() => CollectionSchema.parse({ ...baseCollection, fields: [] })).toThrow();
  });

  it("rejects duplicate field ids", () => {
    expect(() =>
      CollectionSchema.parse({
        ...baseCollection,
        fields: [
          { id: "x", label: "X", type: "text" },
          { id: "x", label: "Y", type: "number" },
        ],
      }),
    ).toThrow();
  });
});
