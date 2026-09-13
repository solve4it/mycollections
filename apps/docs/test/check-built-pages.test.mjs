import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtPageFor, CONTENT_ROOT, DIST } from "../scripts/check-built-pages.mjs";

/**
 * `builtPageFor` is the mapping the whole check rests on: a content file that
 * maps to the wrong path reads as "produced no page" and fails a green build.
 */
describe("builtPageFor", () => {
  it("maps a shared doc to its directory index", () => {
    expect(builtPageFor(join(CONTENT_ROOT, "user", "items.md"))).toBe(join(DIST, "user", "items", "index.html"));
  });

  it("maps an index page to its parent directory", () => {
    expect(builtPageFor(join(CONTENT_ROOT, "user", "index.md"))).toBe(join(DIST, "user", "index.html"));
  });

  it("maps the site root index to the site root", () => {
    expect(builtPageFor(join(CONTENT_ROOT, "index.mdx"))).toBe(join(DIST, "index.html"));
  });
});
