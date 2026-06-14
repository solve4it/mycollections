import { describe, expect, it } from "vitest";
import type { Collection } from "./collection.js";
import { EXPORT_VERSION, ExportDocumentSchema } from "./export-document.js";
import type { Item } from "./item.js";

const collection: Collection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Records",
  fields: [{ id: "title", label: "Title", type: "text", required: true }],
  isFiniteSet: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const item: Item = {
  id: "22222222-2222-4222-8222-222222222222",
  collectionId: collection.id,
  status: "owned",
  fields: { title: "Kind of Blue" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function validDocument() {
  return {
    version: EXPORT_VERSION,
    exportedAt: "2026-06-14T12:00:00.000Z",
    collections: [collection],
    items: [item],
  };
}

describe("ExportDocumentSchema", () => {
  it("accepts a well-formed document", () => {
    const parsed = ExportDocumentSchema.parse(validDocument());
    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(parsed.collections).toHaveLength(1);
    expect(parsed.items).toHaveLength(1);
  });

  it("accepts a document with no collections or items", () => {
    const parsed = ExportDocumentSchema.parse({
      version: EXPORT_VERSION,
      exportedAt: "2026-06-14T12:00:00.000Z",
      collections: [],
      items: [],
    });
    expect(parsed.collections).toEqual([]);
    expect(parsed.items).toEqual([]);
  });

  it("rejects an unknown version", () => {
    expect(() => ExportDocumentSchema.parse({ ...validDocument(), version: 999 })).toThrow();
  });

  it("rejects a missing exportedAt timestamp", () => {
    const { exportedAt, ...withoutTimestamp } = validDocument();
    void exportedAt;
    expect(() => ExportDocumentSchema.parse(withoutTimestamp)).toThrow();
  });

  it("rejects unknown top-level keys", () => {
    expect(() => ExportDocumentSchema.parse({ ...validDocument(), extra: true })).toThrow();
  });

  it("rejects a malformed collection", () => {
    expect(() => ExportDocumentSchema.parse({ ...validDocument(), collections: [{ id: "not-a-uuid" }] })).toThrow();
  });
});
