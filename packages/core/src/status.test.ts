import { describe, expect, it } from "vitest";
import { ITEM_STATUSES, ItemStatusSchema } from "./status.js";

describe("ItemStatus", () => {
  it("exposes the canonical status list", () => {
    expect(ITEM_STATUSES).toEqual(["owned", "wanted", "ordered"]);
  });

  it.each(ITEM_STATUSES)("accepts %s", (status) => {
    expect(ItemStatusSchema.parse(status)).toBe(status);
  });

  it("rejects unknown statuses", () => {
    expect(() => ItemStatusSchema.parse("lost")).toThrow();
  });
});
