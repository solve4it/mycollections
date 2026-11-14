import { describe, expect, it } from "vitest";
import { exportFileName } from "./download.js";

const DAY = new Date("2026-11-14T12:00:00.000Z");

describe("exportFileName (#45)", () => {
  it("keeps the collection's own name, accents included", () => {
    expect(exportFileName("Café records", DAY)).toBe("mycollections-Café records-2026-11-14.zip");
  });

  it("turns control characters and characters a file system refuses into single spaces", () => {
    expect(exportFileName('A/B\\C:"D"*?<E>|\r\nF', DAY)).toBe("mycollections-A B C D E F-2026-11-14.zip");
  });

  it("falls back to a plain word when nothing usable is left", () => {
    expect(exportFileName("///", DAY)).toBe("mycollections-collection-2026-11-14.zip");
  });

  it("caps a very long name", () => {
    expect(exportFileName("x".repeat(500), DAY)).toBe(`mycollections-${"x".repeat(80)}-2026-11-14.zip`);
  });
});
