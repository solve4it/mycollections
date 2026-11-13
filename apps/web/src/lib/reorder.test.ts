import { describe, expect, it } from "vitest";
import { moveOnto } from "./reorder.js";

describe("moveOnto (#37)", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an id forward into the slot it was dropped on, shifting the rest back", () => {
    expect(moveOnto(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an id backward into the slot it was dropped on, shifting the rest forward", () => {
    expect(moveOnto(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("answers null for a drop that changes nothing — onto itself, nowhere, or an unknown id", () => {
    expect(moveOnto(ids, "b", "b")).toBeNull();
    expect(moveOnto(ids, "b", null)).toBeNull();
    expect(moveOnto(ids, "x", "b")).toBeNull();
    expect(moveOnto(ids, "b", "x")).toBeNull();
  });

  it("leaves the list it was given alone", () => {
    const before = [...ids];
    moveOnto(ids, "a", "d");
    expect(ids).toEqual(before);
  });
});
