import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";
import { extractBlock } from "./wcag.js";

/**
 * The collection card (#223). jsdom applies no stylesheet and computes no
 * layout, so these assertions read global.css directly — the same approach
 * nav-cascade.integration.test.ts takes, and the only way to hold the parts of
 * the design that are pure CSS: the 5:3 cover, the motion gate, and the card's
 * migration off the legacy --color-* aliases.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

/**
 * The stylesheet either side of the reduced-motion block. Splitting them keeps
 * `only()` honest: `.collection-card:hover` is declared twice on purpose — once
 * to lift, once to cancel the lift — and a test that could not tell them apart
 * would pass whichever one it happened to find first.
 */
const RULES = parseRules(css.split(REDUCED_MOTION)[0] ?? "");
// extractBlock returns the braces too, and parseRules would read those as one
// anonymous rule wrapping everything; slice them off so the children are seen.
const REDUCED = parseRules(extractBlock(css, REDUCED_MOTION).slice(1, -1));

function only(selector: string) {
  const matches = rulesFor(RULES, selector);
  expect(matches, `global.css must declare exactly one \`${selector}\` rule`).toHaveLength(1);
  const rule = matches[0];
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
}

describe("collection card", () => {
  it("sits on the card surface with a paper-palette border", () => {
    const card = only(".collection-card");
    expect(declaration(card.body, "background")).toBe("var(--card)");
    expect(declaration(card.body, "border")).toBe("1px solid var(--line)");
    expect(declaration(card.body, "color")).toBe("var(--ink)");
  });

  it("is built from semantic tokens, not the legacy --color-* aliases", () => {
    // DESIGN.md: #221-#225 migrate consumers off the aliases, then they go away.
    // Scoped to the card's own rules so this does not collide with #224.
    for (const rule of RULES.filter((r) => /^\.collection-(card|cover|grid)/.test(r.selector))) {
      expect(rule.body, `${rule.selector} still uses a legacy alias`).not.toMatch(/var\(--color-/);
    }
  });

  it("declares the cover palette on the cover, never in :root", () => {
    // Found by driving a real browser, and invisible to every other test here:
    // a custom property that references another is substituted where it is
    // *declared*. `--cover-bg: hsl(var(--cover-hue) ...)` in :root resolves
    // against a --cover-hue that does not exist there, computes to an invalid
    // color, and paints every cover black. jsdom resolves no var() at all, so a
    // structural rule is the only guard available.
    for (const block of [
      ":root {",
      "@media (prefers-color-scheme: dark)",
      ':root[data-theme="dark"]',
      ':root[data-theme="light"]',
    ]) {
      expect(extractBlock(css, block), `${block} must not declare the cover palette`).not.toMatch(
        /--cover-(bg|ink|accent)\s*:/,
      );
    }

    const base = rulesFor(RULES, ".collection-cover")[0];
    for (const token of ["--cover-bg", "--cover-ink", "--cover-accent"]) {
      expect(declaration(base?.body ?? "", token), `${token} belongs on .collection-cover`).toMatch(
        /hsl\(var\(--cover-hue\)/,
      );
    }
  });

  it("takes the cover palette down with the paper in dark mode", () => {
    // The dark override is a bare `.collection-cover` inside the media query;
    // the explicit-theme ones are prefixed with :root[data-theme=…].
    const overrides = RULES.filter((rule) => /\.collection-cover$/.test(rule.selector.trim())).slice(1);
    expect(overrides.length, "dark and explicit-theme overrides must all exist").toBeGreaterThanOrEqual(3);
    for (const rule of overrides) {
      expect(declaration(rule.body, "--cover-bg")).toMatch(/hsl\(var\(--cover-hue\)/);
    }
  });

  it("reserves a 5:3 cover that cannot be squashed by its content", () => {
    const cover = rulesFor(RULES, ".collection-cover")[0];
    expect(declaration(cover?.body ?? "", "aspect-ratio")).toBe("5 / 3");
    expect(declaration(cover?.body ?? "", "width")).toBe("100%");
    // Without this the SVG paints over the card's rounded corners.
    expect(declaration(only(".collection-card").body, "overflow")).toBe("hidden");
  });

  it("writes the eyebrow in the typewritten label voice", () => {
    const eyebrow = only(".collection-card-eyebrow");
    expect(declaration(eyebrow.body, "font-family")).toBe("var(--font-mono)");
    expect(declaration(eyebrow.body, "color")).toBe("var(--ink-muted)");
    // The uppercase is applied in CSS, never written into the locale string:
    // the DOM keeps the real text, so a test can still match it and
    // `items_count` pluralization stays intact.
    expect(declaration(eyebrow.body, "text-transform")).toBe("uppercase");
  });

  it("paints the eyebrow above the name it follows in the DOM, with a separator that is not spoken (#370)", () => {
    expect(declaration(only(".collection-card-eyebrow").body, "order")).toBe("-1");
    // The empty alt text is what keeps generated content out of the link's
    // accessible name; a bare `content: "·"` is announced.
    expect(declaration(only(".collection-card-count::before").body, "content")).toBe('"·" / ""');
  });

  it("lifts the card on hover", () => {
    const hover = only(".collection-card:hover");
    expect(declaration(hover.body, "transform")).toBe("translateY(-2px)");
    expect(declaration(hover.body, "box-shadow")).toBe("var(--shadow-lift)");
    expect(declaration(only(".collection-card").body, "transition")).toMatch(/transform|box-shadow/);
  });
});

describe("reduced motion", () => {
  // The card lift is the first animation in the app; #225 inherits this block.
  it("exists as a single global block rather than per-rule opt-outs", () => {
    expect(REDUCED.length).toBeGreaterThan(0);
  });

  it("stops every transition and animation", () => {
    const universal = rulesFor(REDUCED, "*")[0];
    expect(universal, "reduced motion must neutralize transitions globally").toBeDefined();
    expect(declaration(universal?.body ?? "", "transition-duration")).toMatch(/0\.01ms !important/);
    expect(declaration(universal?.body ?? "", "animation-duration")).toMatch(/0\.01ms !important/);
  });

  it("removes the card's hover lift instead of merely making it instant", () => {
    // Zeroing the duration alone leaves a 2px jump under the pointer — motion,
    // just faster. The displacement itself has to go.
    const hover = rulesFor(REDUCED, ".collection-card:hover")[0];
    expect(hover, "reduced motion must cancel the card lift").toBeDefined();
    expect(declaration(hover?.body ?? "", "transform")).toBe("none");
  });
});

/**
 * A finite set's progress (#42), on the card and the collection header. The
 * fill colors come from tokens, so the contrast test holds them; what is held
 * here is that the rules actually use those tokens, that the track has an edge
 * of its own, and that forced-colors mode keeps fill and track apart.
 */
describe("finite-set progress", () => {
  const FORCED_OPENER = "@media (forced-colors: active)";
  const forcedBlock = extractBlock(css, FORCED_OPENER);
  const FORCED = parseRules(forcedBlock.slice(1, -1));
  // The everyday rules, with the forced-colors overrides set aside so `only()`
  // can tell the base fill from its high-contrast stand-in.
  const BASE = parseRules((css.split(REDUCED_MOTION)[0] ?? "").replace(`${FORCED_OPENER} ${forcedBlock}`, ""));
  const only = (selector: string) => {
    const matches = rulesFor(BASE, selector);
    expect(matches, `global.css must declare exactly one \`${selector}\` rule`).toHaveLength(1);
    const rule = matches[0];
    if (!rule) throw new Error(`no rule for ${selector}`);
    return rule;
  };

  it("fills in manila-ink, and in the owned green once the set is complete", () => {
    expect(declaration(only(".collection-progress-fill").body, "background")).toBe("var(--progress)");
    expect(declaration(only(".collection-progress-complete .collection-progress-fill").body, "background")).toBe(
      "var(--owned)",
    );
  });

  it("draws the track with a border, since --line on --card is only 1.28:1", () => {
    const track = only(".collection-progress-track");
    expect(declaration(track.body, "background")).toBe("var(--line)");
    expect(declaration(track.body, "border")).toBe("1px solid var(--ink-muted)");
    // Spans inside a <p>: inline by default, where a block size does nothing.
    expect(declaration(track.body, "display")).toBe("block");
    expect(declaration(only(".collection-progress-fill").body, "display")).toBe("block");
  });

  it("keeps fill and track apart in forced-colors mode", () => {
    const track = rulesFor(FORCED, ".collection-progress-track")[0];
    expect(declaration(track?.body ?? "", "border-color")).toBe("CanvasText");
    const fill = rulesFor(FORCED, ".collection-progress-fill")[0];
    // Forced colors repaints a background as Canvas, which would erase the fill;
    // opting it out and painting a system color keeps the amount visible.
    expect(declaration(fill?.body ?? "", "forced-color-adjust")).toBe("none");
    expect(declaration(fill?.body ?? "", "background")).toBe("Highlight");
  });

  it("sits last on the card, pushed to the bottom so bars line up across a grid row", () => {
    const body = only(".collection-card-body");
    expect(declaration(body.body, "display")).toBe("flex");
    expect(declaration(body.body, "flex-direction")).toBe("column");
    expect(declaration(body.body, "flex-grow")).toBe("1");
    expect(declaration(only(".collection-card-body .collection-progress").body, "margin-block-start")).toBe("auto");
  });

  it("never declares the --progress color token anywhere but the palette blocks", () => {
    // --progress is a color. A rule that set it as a fill amount would shadow
    // the token for its subtree and paint every fill below it invalid (#42).
    const declaring = parseRules(css).filter((rule) => /(^|[;{\s])--progress\s*:/.test(rule.body));
    expect(declaring.map((rule) => rule.selector)).toEqual([
      ":root",
      ":root",
      ':root[data-theme="dark"]',
      ':root[data-theme="light"]',
    ]);
  });

  it("never sets --progress as an inline style in the app's source", () => {
    // Comments may name the token (the widget explains why it avoids it); code
    // may not set it — as a style key, or inside a style string.
    const offenders = sourceFiles(resolve("src")).filter((path) => {
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /["'`]--progress["'`]\s*[:\]]|--progress\s*:|setProperty\(\s*["'`]--progress/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

/** Shipped components only: tests and stylesheets describe the token. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}
