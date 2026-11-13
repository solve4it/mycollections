import { describe, expect, it } from "vitest";
import { MEDIA_SOURCES, MediaSchema } from "./media.js";

const baseMedia = {
  id: "33333333-3333-4333-8333-333333333333",
  itemId: "22222222-2222-4222-8222-222222222222",
  kind: "image",
  source: "user-camera",
  mimeType: "image/webp",
  bytes: 12345,
  width: 2560,
  height: 1920,
  position: 0,
  createdAt: "2026-05-25T00:00:00.000Z",
};

describe("MediaSchema", () => {
  it("parses valid media, keeping where it came from and its size and place", () => {
    const parsed = MediaSchema.parse(baseMedia);
    expect(parsed).toEqual({ ...baseMedia, deletedAt: null });
  });

  it("names the three places an image can come from (#37)", () => {
    // `lookup` arrives with #40; it is in the enum now so that needs no migration.
    expect(MEDIA_SOURCES).toEqual(["user-attached", "user-camera", "lookup"]);
    expect(() => MediaSchema.parse({ ...baseMedia, source: "upload" })).toThrow();
  });

  it("has no primary flag and no stored path — the first by position is the primary, and paths derive from ids", () => {
    const parsed = MediaSchema.parse({ ...baseMedia, isPrimary: true, storagePath: "/abs/path.webp" });
    expect(parsed).not.toHaveProperty("isPrimary");
    expect(parsed).not.toHaveProperty("storagePath");
  });

  it("rejects a negative position and a zero or fractional dimension", () => {
    expect(() => MediaSchema.parse({ ...baseMedia, position: -1 })).toThrow();
    expect(() => MediaSchema.parse({ ...baseMedia, width: 0 })).toThrow();
    expect(() => MediaSchema.parse({ ...baseMedia, height: 1.5 })).toThrow();
  });

  it("rejects negative byte counts", () => {
    expect(() => MediaSchema.parse({ ...baseMedia, bytes: -1 })).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => MediaSchema.parse({ ...baseMedia, kind: "video" })).toThrow();
  });

  it("defaults deletedAt to null", () => {
    expect(MediaSchema.parse(baseMedia).deletedAt).toBeNull();
  });

  it("accepts a deletedAt timestamp", () => {
    const parsed = MediaSchema.parse({ ...baseMedia, deletedAt: "2026-05-26T00:00:00.000Z" });
    expect(parsed.deletedAt).toBe("2026-05-26T00:00:00.000Z");
  });
});
