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
    expect(scopedId("p", "field", " ")).not.toBe(scopedId("p", "field", "_0020"));
    expect(scopedId("p", "field", "_")).not.toBe(scopedId("p", "field", "_005f"));
  });

  // Ids get turned into `#id` selectors — the keyboard spec looks a hint up by
  // its `aria-describedby` that way — so every id must be a plain CSS
  // identifier: no `:`, no `%`, nothing that needs `CSS.escape`.
  it("is usable as a CSS id selector without escaping, whatever the key", () => {
    const keys = ["title", "release year", "hint-foo", "a:b", "50%", "_x", "\ud800", "日本", "a__b"];
    for (const key of keys) {
      const id = scopedId("_r_0_", "type-hint", key);
      expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
      const el = document.createElement("p");
      el.id = id;
      document.body.append(el);
      expect(document.querySelector(`#${id}`)).toBe(el);
      el.remove();
    }
  });

  it("keeps a key containing the separator from meeting a different split", () => {
    expect(scopedId("p", "a", "b__c")).not.toBe(scopedId("p", "a__b", "c"));
  });
});
