import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";
import { contrast, extractBlock, NON_TEXT, TEXT, tokensFromBlock } from "./wcag.js";

/**
 * The status tabs (#42). jsdom applies no stylesheet, so — as in the other
 * style tests — this reads global.css and holds what only exists in CSS: the
 * selected tab is marked by more than color, in both themes and in forced
 * colors, and every tab is a full touch target.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const forced = parseRules(extractBlock(css, "@media (forced-colors: active)").slice(1, -1));
const forcedBodies = new Set(forced.map((rule) => rule.body));
/** The rules outside forced colors: the flattened sheet, less what that block contributes. */
const RULES = parseRules(css).filter((rule) => !forcedBodies.has(rule.body));

const light = tokensFromBlock(extractBlock(css, ":root {"));
const dark = { ...light, ...tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)")) };

function only(rules: ReturnType<typeof parseRules>, selector: string) {
  const matches = rulesFor(rules, selector);
  expect(matches, `exactly one \`${selector}\` rule`).toHaveLength(1);
  const rule = matches[0];
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
}

function token(value: string | undefined): string {
  const match = value?.match(/var\(--([\w-]+)\)/);
  if (!match?.[1]) throw new Error(`not a token: ${value}`);
  return match[1];
}

describe("the status tabs (#42)", () => {
  const tab = only(RULES, ".status-tab");
  const selected = only(RULES, '.status-tab[aria-selected="true"]');

  it("marks the selected tab with an underline and weight, not color alone", () => {
    // Every tab reserves the underline's space, so selecting one does not move the row.
    expect(declaration(tab.body, "border-bottom")).toBe("3px solid transparent");
    expect(declaration(selected.body, "border-bottom-color")).toBe("var(--accent-text)");
    expect(declaration(selected.body, "font-weight")).toBe("600");
  });

  it("keeps both labels legible and the underline visible on the page, in both themes", () => {
    const unselectedInk = token(declaration(tab.body, "color"));
    const selectedInk = token(declaration(selected.body, "color"));
    const underline = token(declaration(selected.body, "border-bottom-color"));
    for (const [theme, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const paper = tokens.paper as string;
      expect(contrast(tokens[unselectedInk] as string, paper), `${theme} unselected label`).toBeGreaterThanOrEqual(
        TEXT,
      );
      expect(contrast(tokens[selectedInk] as string, paper), `${theme} selected label`).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(tokens[underline] as string, paper), `${theme} underline`).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it("is a touch target, sized by the shared class rather than its own rule", () => {
    // The component puts `.touch-target` on each tab; the tab rule must not undo it.
    expect(declaration(tab.body, "min-height")).toBeUndefined();
    expect(declaration(tab.body, "height")).toBeUndefined();
  });

  it("repaints the underline in system colors under forced colors, where a transparent border would show on every tab", () => {
    expect(declaration(only(forced, ".status-tab").body, "border-bottom-color")).toBe("Canvas");
    expect(declaration(only(forced, '.status-tab[aria-selected="true"]').body, "border-bottom-color")).toBe(
      "Highlight",
    );
  });
});
