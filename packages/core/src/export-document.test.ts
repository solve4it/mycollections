import { describe, expect, it } from "vitest";
import type { Collection } from "./collection.js";
import { EXPORT_VERSION, ExportDocumentSchema } from "./export-document.js";
import type { Item } from "./item.js";
import type { Media } from "./media.js";

const collection: Collection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Records",
  fields: [{ id: "title", label: "Title", type: "text", required: true }],
  isFiniteSet: false,
  targetCount: null,
  itemView: "list",
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

const image: Media = {
  id: "33333333-3333-4333-8333-333333333333",
  itemId: item.id,
  kind: "image",
  source: "user-attached",
  mimeType: "image/webp",
  bytes: 1234,
  width: 640,
  height: 480,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function validDocument() {
  return {
    version: EXPORT_VERSION,
    exportedAt: "2026-06-14T12:00:00.000Z",
    collections: [collection],
    items: [item],
    media: [image],
  };
}

/** A version 1 backup as #189 wrote it: no media key at all. */
function versionOneDocument() {
  return {
    version: 1,
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
      media: [],
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

  it("reads a version 1 backup written before views existed, defaulting itemView to list (#38)", () => {
    const { itemView, ...older } = { ...collection, itemView: "grid" };
    void itemView;
    const parsed = ExportDocumentSchema.parse({ ...validDocument(), collections: [older] });
    expect(parsed.collections[0]?.itemView).toBe("list");
  });

  it("round-trips a collection's grid view (#38)", () => {
    const parsed = ExportDocumentSchema.parse({
      ...validDocument(),
      collections: [{ ...collection, itemView: "grid" }],
    });
    expect(parsed.collections[0]?.itemView).toBe("grid");
  });

  it("reads a version 1 backup written before targets existed, defaulting targetCount to null (#42)", () => {
    const { targetCount, ...older } = { ...collection, isFiniteSet: true };
    void targetCount;
    const parsed = ExportDocumentSchema.parse({ ...validDocument(), collections: [older] });
    expect(parsed.collections[0]?.targetCount).toBeNull();
    expect(parsed.collections[0]?.isFiniteSet).toBe(true);
  });

  it("keeps a finite set's target (#42)", () => {
    const parsed = ExportDocumentSchema.parse({
      ...validDocument(),
      collections: [{ ...collection, isFiniteSet: true, targetCount: 50 }],
    });
    expect(parsed.collections[0]?.targetCount).toBe(50);
  });

  it("rejects a document holding a target on a collection that is not a finite set (#42)", () => {
    const result = ExportDocumentSchema.safeParse({
      ...validDocument(),
      collections: [{ ...collection, isFiniteSet: false, targetCount: 50 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("targetCount requires isFiniteSet");
  });

  describe("version 2: images (#45)", () => {
    it("is the version written today", () => {
      expect(EXPORT_VERSION).toBe(2);
    });

    it("keeps every image row, soft-deleted ones included", () => {
      const trashed = {
        ...image,
        id: "44444444-4444-4444-8444-444444444444",
        position: 1,
        deletedAt: "2026-02-01T00:00:00.000Z",
      };
      const parsed = ExportDocumentSchema.parse({ ...validDocument(), media: [image, trashed] });
      expect(parsed.media).toEqual([image, trashed]);
    });

    it("reads a version 1 backup as a version 2 document with no images", () => {
      const parsed = ExportDocumentSchema.parse(versionOneDocument());
      expect(parsed).toEqual({ ...versionOneDocument(), version: 2, media: [] });
    });

    it("refuses a version 1 document carrying media, which no version 1 writer produced", () => {
      expect(() => ExportDocumentSchema.parse({ ...versionOneDocument(), media: [image] })).toThrow();
    });

    it("refuses a version 2 document without its media list", () => {
      const { media: _media, ...withoutMedia } = validDocument();
      expect(() => ExportDocumentSchema.parse(withoutMedia)).toThrow();
    });

    it("refuses two image rows with one id, which would make the import ambiguous about which file is which", () => {
      expect(() =>
        ExportDocumentSchema.parse({ ...validDocument(), media: [image, { ...image, position: 1 }] }),
      ).toThrow();
    });

    it("refuses an image whose item is not in the document", () => {
      const stray = { ...image, itemId: "55555555-5555-4555-8555-555555555555" };
      expect(() => ExportDocumentSchema.parse({ ...validDocument(), media: [stray] })).toThrow();
    });
  });
});
