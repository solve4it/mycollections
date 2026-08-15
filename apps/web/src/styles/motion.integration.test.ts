import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";
import { extractBlock } from "./wcag.js";

/**
 * Motion, skeletons and the clipped label (#225). jsdom applies no stylesheet
 * and runs no animation, so — as in card.integration.test.ts — these assertions
 * read global.css directly. What they hold is the part of the design that only
 * exists in CSS: the shimmer's resting state, the 150ms screen entrance, and the
 * rule that the motion opt-out stays a single block.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const FORCED_COLORS = "@media (forced-colors: active)";
// The stylesheet up to its two accessibility overrides. Splitting them off keeps
// `only()` honest: .skeleton is declared twice on purpose — once as itself, once
// as what forced-colors mode needs it to be.
const RULES = parseRules((css.split(REDUCED_MOTION)[0] ?? "").split(FORCED_COLORS)[0] ?? "");
const FORCED = parseRules(extractBlock(css, FORCED_COLORS).slice(1, -1));

function only(selector: string) {
  const matches = rulesFor(RULES, selector);
  expect(matches, `global.css must declare exactly one \`${selector}\` rule`).toHaveLength(1);
  const rule = matches[0];
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
}

/** The first percentage in a value, e.g. "-150% 0" → -150. */
function firstPercentage(value: string | undefined): number {
  const match = /(-?\d+(?:\.\d+)?)%/.exec(value ?? "");
  expect(match, `expected a percentage in "${value}"`).not.toBeNull();
  return Number(match?.[1]);
}

describe("skeleton", () => {
  it("is a placeholder in the paper palette, not a legacy alias", () => {
    const skeleton = only(".skeleton");
    expect(declaration(skeleton.body, "background-color")).toBe("var(--line)");
    expect(skeleton.body).not.toMatch(/var\(--color-/);
  });

  it("shimmers by sliding a highlight across itself", () => {
    expect(declaration(only(".skeleton").body, "animation")).toMatch(/skeleton-shimmer/);
    expect(extractBlock(css, "@keyframes skeleton-shimmer")).toMatch(/background-position/);
  });

  it("sweeps between surface tokens rather than a white overlay", () => {
    // The nav pills' white-at-low-alpha trick does not transfer: they sit on
    // --cabinet, dark in both themes, while a skeleton sits on paper, which
    // flips. Sweeping toward --card reads as the block thinning in either.
    const highlight = declaration(only(".skeleton").body, "background-image");
    expect(highlight).toMatch(/var\(--card\)/);
    expect(highlight, "no white-alpha overlay on a surface that flips").not.toMatch(/rgb|rgba|#/);
  });

  it("stays visible in forced-colors mode, where background paint is discarded", () => {
    // Forced colors drops background-image and repaints background-color, so a
    // placeholder built from fills alone becomes blank space — the loading
    // screen turns into an empty page. Presence, not paint: the same call the
    // status dot and the active nav notch already make.
    const forced = rulesFor(FORCED, ".skeleton")[0];
    expect(forced, "forced-colors mode must give the placeholder an edge").toBeDefined();
    expect(declaration(forced?.body ?? "", "border")).toMatch(/1px solid/);
  });

  it("rests with the highlight off the block, so a stopped shimmer is a flat placeholder", () => {
    // This is what makes the reduced-motion opt-out correct rather than merely
    // fast. The global block sets animation-duration to 0.01ms with no fill
    // mode, so the element falls back to its own background-position within a
    // frame: park it off-canvas and a user who asked for no motion sees a plain
    // block, never a bright streak frozen mid-slide.
    const resting = firstPercentage(declaration(only(".skeleton").body, "background-position"));
    expect(resting < 0 || resting > 100, `a resting highlight at ${resting}% is on the block`).toBe(true);
  });

  it("borrows the collection card's box for its placeholder cards", () => {
    // The skeleton grid must be the same size as the grid that replaces it —
    // otherwise the page jumps under the pointer the moment data lands.
    const card = only(".skeleton-card");
    expect(declaration(card.body, "border")).toBe("1px solid var(--line)");
    expect(declaration(card.body, "border-radius")).toBe("var(--radius)");
    expect(declaration(card.body, "background")).toBe("var(--card)");
    expect(declaration(only(".skeleton-cover").body, "aspect-ratio")).toBe("5 / 3");
  });

  it("does not lift on hover: a placeholder is not a target", () => {
    expect(rulesFor(RULES, ".skeleton-card:hover")).toHaveLength(0);
  });
});

describe("screen transition", () => {
  it("fades a screen in over 150ms", () => {
    expect(declaration(only(".screen").body, "animation")).toMatch(/screen-in|150ms/);
    expect(declaration(only(".screen").body, "animation")).toMatch(/150ms/);
  });

  it("ends fully opaque and back in place, so an interrupted entrance cannot strand the page", () => {
    const frames = extractBlock(css, "@keyframes screen-in");
    const to = frames.slice(frames.lastIndexOf("to"));
    expect(declaration(to, "opacity")).toBe("1");
    expect(declaration(to, "transform")).toBe("none");
  });
});

describe("the motion opt-out", () => {
  it("stays a single global block rather than a per-rule opt-out", () => {
    // DESIGN.md: one gate, at the end of the file. A second block is how an
    // animation ends up outside the gate without anyone noticing.
    expect(css.split(REDUCED_MOTION)).toHaveLength(2);
  });

  it("covers the shimmer and the screen entrance, which are declared before it", () => {
    expect(css.indexOf(".skeleton")).toBeLessThan(css.indexOf(REDUCED_MOTION));
    expect(css.indexOf(".screen")).toBeLessThan(css.indexOf(REDUCED_MOTION));
  });
});

describe("the clipped label", () => {
  it("keeps text available to screen readers while taking no space", () => {
    // display:none and visibility:hidden would silence it; clipping a 1px box
    // leaves it in the accessibility tree and in the DOM, which is also what
    // keeps the existing "shows loading, never the empty state" guards honest.
    const hidden = only(".visually-hidden");
    expect(declaration(hidden.body, "display")).not.toBe("none");
    expect(declaration(hidden.body, "visibility")).not.toBe("hidden");
    expect(declaration(hidden.body, "position")).toBe("absolute");
    expect(declaration(hidden.body, "width")).toBe("1px");
    expect(declaration(hidden.body, "height")).toBe("1px");
    expect(declaration(hidden.body, "overflow")).toBe("hidden");
  });
});

describe("empty state", () => {
  it("is built from semantic tokens, not the legacy --color-* aliases", () => {
    // DESIGN.md: #221-#225 migrate consumers off the aliases, then they go away.
    for (const rule of RULES.filter((r) => /^\.empty-(state|mark)/.test(r.selector))) {
      expect(rule.body, `${rule.selector} still uses a legacy alias`).not.toMatch(/var\(--color-/);
    }
  });

  it("titles itself in body ink and explains itself in muted ink", () => {
    expect(declaration(only(".empty-state").body, "color")).toBe("var(--ink-muted)");
    expect(declaration(only(".empty-state-title").body, "color")).toBe("var(--ink)");
  });
});
