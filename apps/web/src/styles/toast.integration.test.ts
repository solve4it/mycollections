import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";
import { contrast, extractBlock, TEXT, tokensFromBlock } from "./wcag.js";

/**
 * The undo toast (#33). jsdom applies no stylesheet, so — as in
 * motion.integration.test.ts — these read global.css directly and hold the part
 * of the toast that only exists in CSS: it must sit *under* the bottom nav, it
 * must be legible on the cabinet surface in both themes, and its motion must be
 * a CSS animation so the global reduced-motion opt-out reaches it.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const RULES = parseRules(css);

const lightTokens = tokensFromBlock(extractBlock(css, ":root {"));
const darkTokens = {
  ...lightTokens,
  ...tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)")),
};

function only(selector: string) {
  const matches = rulesFor(RULES, selector);
  expect(matches, `global.css must declare exactly one \`${selector}\` rule`).toHaveLength(1);
  const rule = matches[0];
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
}

/**
 * The z-index a selector sets. `.shell-bottom-nav` is declared twice on purpose
 * (once as itself, once inside the mobile media query), so this takes the rule
 * that actually carries the property rather than insisting on a single match.
 */
function zIndexOf(selector: string): number {
  const values = rulesFor(RULES, selector)
    .map((rule) => declaration(rule.body, "z-index"))
    .filter((value): value is string => value !== undefined);
  expect(values, `no z-index declared for \`${selector}\``).toHaveLength(1);
  return Number(values[0]);
}

describe("undo toast placement", () => {
  it("never covers the bottom nav — a message must not hide the way off the screen", () => {
    expect(zIndexOf(".undo-toast-region")).toBeLessThan(zIndexOf(".shell-bottom-nav"));
  });

  it("clears the bottom nav's height rather than overlapping it", () => {
    const bottom = declaration(only(".undo-toast-region").body, "bottom");
    expect(bottom).toContain("var(--bottom-nav-height)");
  });

  it("is pinned to the viewport, so it survives the row that spawned it scrolling away", () => {
    expect(declaration(only(".undo-toast-region").body, "position")).toBe("fixed");
  });
});

describe("undo toast legibility", () => {
  it("sits on the cabinet surface with its own border and lift", () => {
    const toast = only(".undo-toast").body;
    expect(declaration(toast, "background")).toBe("var(--cabinet)");
    expect(declaration(toast, "color")).toBe("var(--cabinet-ink)");
    expect(declaration(toast, "border")).toContain("var(--cabinet-line)");
  });

  it.each([
    ["light", lightTokens],
    ["dark", darkTokens],
  ])("%s: message and action clear 4.5:1 on the cabinet", (_theme, tokens) => {
    const cabinet = tokens.cabinet;
    const ink = tokens["cabinet-ink"];
    const action = tokens.manila;
    if (!cabinet || !ink || !action) throw new Error("missing cabinet tokens");
    expect(contrast(ink, cabinet), `message ink = ${contrast(ink, cabinet).toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(action, cabinet), `action ink = ${contrast(action, cabinet).toFixed(2)}:1`).toBeGreaterThanOrEqual(
      TEXT,
    );
  });

  it("keeps a focus ring that is visible on the cabinet, not the paper one", () => {
    // --focus is tuned for paper and all but vanishes on --cabinet, which is why
    // the nav carries its own ring; the toast lands on the same surface.
    expect(declaration(only(".undo-toast :focus-visible").body, "outline")).toContain("var(--focus-on-cabinet)");
  });
});

describe("undo toast motion", () => {
  it("enters with a CSS animation, so the reduced-motion opt-out reaches it", () => {
    expect(declaration(only(".undo-toast").body, "animation")).toMatch(/toast-in/);
    expect(extractBlock(css, "@keyframes toast-in")).toMatch(/opacity/);
  });

  it("is covered by the global reduced-motion block rather than opting out itself", () => {
    const optOut = extractBlock(css, "@media (prefers-reduced-motion: reduce)");
    expect(optOut).toContain("animation-duration: 0.01ms !important");
    expect(optOut, "the toast needs no rule of its own — `*` already covers it").not.toContain("undo-toast");
  });
});
