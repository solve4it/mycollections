import { describe, expect, it } from "vitest";
import { MediaSchema } from "./media.js";

const baseMedia = {
  id: "33333333-3333-4333-8333-333333333333",
  itemId: "22222222-2222-4222-8222-222222222222",
  kind: "image",
  mimeType: "image/jpeg",
  bytes: 12345,
  isPrimary: true,
  createdAt: "2026-05-25T00:00:00.000Z",
};

describe("MediaSchema", () => {
  it("parses valid media", () => {
    const parsed = MediaSchema.parse(baseMedia);
    expect(parsed.kind).toBe("image");
  });

  it("rejects negative byte counts", () => {
    expect(() => MediaSchema.parse({ ...baseMedia, bytes: -1 })).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => MediaSchema.parse({ ...baseMedia, kind: "video" })).toThrow();
  });
});
