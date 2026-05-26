import { describe, expect, it } from "vitest";
import { ItemSchema } from "./item.js";

const baseItem = {
  id: "22222222-2222-4222-8222-222222222222",
  collectionId: "11111111-1111-4111-8111-111111111111",
  status: "owned",
  fields: { title: "Kind of Blue" },
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("ItemSchema", () => {
  it("parses a valid item", () => {
    const parsed = ItemSchema.parse(baseItem);
    expect(parsed.status).toBe("owned");
  });

  it("rejects an unknown status", () => {
    expect(() => ItemSchema.parse({ ...baseItem, status: "missing" })).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() => ItemSchema.parse({ ...baseItem, id: "abc" })).toThrow();
  });

  it("defaults deletedAt to null", () => {
    const parsed = ItemSchema.parse(baseItem);
    expect(parsed.deletedAt).toBeNull();
  });
});
