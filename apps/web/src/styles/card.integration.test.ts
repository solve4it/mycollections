import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
