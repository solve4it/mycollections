import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COVER_ARCHETYPES, coverFor } from "../lib/cover.js";
import { GeneratedCover } from "./GeneratedCover.js";

afterEach(cleanup);

/** One id known to land on each archetype, so every pattern is actually rendered. */
const ID_PER_ARCHETYPE: Record<string, string> = {
  coins: "00000000-0000-0000-0000-000000000001",
  spines: "00000000-0000-0000-0000-000000000002",
  studs: "11111111-1111-4111-8111-111111111111",
  rings: "550e8400-e29b-41d4-a716-446655440000",
  dials: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  fan: "f0dd2b8a-0000-4000-8000-000000000002",
};

function cover(id: string): SVGElement {
  const element = document.querySelector("svg.collection-cover");
  if (!element) throw new Error(`no cover rendered for ${id}`);
  return element as SVGElement;
}

describe("GeneratedCover", () => {
  it("renders the archetype the generator chose", () => {
    render(<GeneratedCover collectionId="550e8400-e29b-41d4-a716-446655440000" />);
    expect(cover("550e8400-e29b-41d4-a716-446655440000").dataset.archetype).toBe("rings");
  });

  it("paints with the hue the generator chose", () => {
    render(<GeneratedCover collectionId="550e8400-e29b-41d4-a716-446655440000" />);
    // 262 is the hue coverFor pins for this id; the SVG only ever reads it
    // through --cover-hue, so the colors stay a CSS/theme decision.
    expect(cover("x").style.getPropertyValue("--cover-hue")).toBe("262");
  });

  it("draws the same markup every time for the same collection", () => {
    render(<GeneratedCover collectionId="11111111-1111-4111-8111-111111111111" />);
    const first = cover("a").outerHTML;
    cleanup();
    render(<GeneratedCover collectionId="11111111-1111-4111-8111-111111111111" />);
    expect(cover("b").outerHTML).toBe(first);
  });

  it("draws different collections differently", () => {
    render(<GeneratedCover collectionId="550e8400-e29b-41d4-a716-446655440000" />);
    const rings = cover("a").outerHTML;
    cleanup();
    render(<GeneratedCover collectionId="11111111-1111-4111-8111-111111111111" />);
    expect(cover("b").outerHTML).not.toBe(rings);
  });

  it("is decorative — it carries no accessible name and is hidden from assistive tech", () => {
    // The card's <h2> is the accessible content. A cover that announced itself
    // would put "image" between every collection name in a screen-reader list.
    render(<GeneratedCover collectionId="550e8400-e29b-41d4-a716-446655440000" />);
    expect(cover("x").getAttribute("aria-hidden")).toBe("true");
    expect(cover("x").getAttribute("focusable")).toBe("false");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(COVER_ARCHETYPES)("draws actual shapes for the %s archetype", (archetype) => {
    const id = ID_PER_ARCHETYPE[archetype];
    if (!id) throw new Error(`the fixture is missing an id for ${archetype}`);
    // Guards the fixture itself: a hash change would silently point these ids
    // elsewhere and leave an archetype untested.
    expect(coverFor(id).archetype).toBe(archetype);

    render(<GeneratedCover collectionId={id} />);
    const svg = cover(id);
    expect(svg.dataset.archetype).toBe(archetype);
    // A pattern is the background rect plus real geometry on top of it.
    expect(svg.querySelectorAll("circle, rect, path, line, polygon").length).toBeGreaterThan(4);
  });

  it("accepts an extra class without dropping its own", () => {
    render(<GeneratedCover collectionId="550e8400-e29b-41d4-a716-446655440000" className="extra" />);
    expect(cover("x").getAttribute("class")).toBe("collection-cover extra");
  });
});
