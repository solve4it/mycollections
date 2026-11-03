import { describe, expect, it } from "vitest";
import { scopedId } from "./dom-id.js";

describe("scopedId", () => {
  it("joins an instance prefix and a part", () => {
    expect(scopedId("_r_1_", "status")).toBe("_r_1_-status");
  });

  it("keeps keys that differ only in a space and an underscore apart", () => {
    expect(scopedId("p", "field", "release year")).not.toBe(scopedId("p", "field", "release_year"));
  });

  // The part names themselves can contain a dash, and so can a key, so a
  // dash cannot be what separates them: "type" + "hint-foo" and
  // "type-hint" + "foo" must not meet.
  it("never lets a part and a key run into each other", () => {
    expect(scopedId("p", "type", "hint-foo")).not.toBe(scopedId("p", "type-hint", "foo"));
  });

  it("never emits whitespace, which would split an aria-describedby reference", () => {
    for (const key of ["a b", "tab\there", "line\nbreak", " nbsp", " em"]) {
      expect(scopedId("p", "field", key)).not.toMatch(/\s/);
    }
  });

  // A field id is any string JSON can carry, including an unpaired surrogate,
  // which `encodeURIComponent` throws on — during render, taking the screen
  // down with it.
  it("is total: a lone surrogate encodes rather than throwing", () => {
    expect(() => scopedId("p", "field", "\ud800")).not.toThrow();
    expect(scopedId("p", "field", "\ud800")).not.toBe(scopedId("p", "field", "\udc00"));
  });

  it("does not let an escape sequence in a key pass for an escaped character", () => {
    expect(scopedId("p", "field", " ")).not.toBe(scopedId("p", "field", "%0020"));
  });
});
