import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";
import { contrast, extractBlock, NON_TEXT, TEXT, tokensFromBlock } from "./wcag.js";

/**
 * An item row's look (#42, D8 and R13). jsdom applies no stylesheet, so — as in
 * the other style tests — this reads global.css and holds what only exists in
 * CSS: a wanted row is dashed and an ordered row dotted, both in their status
 * color and both legible, without opacity or a filter; forced colors keep the
 * line pattern; and a row wraps rather than crushing its fields at phone width.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const forced = parseRules(extractBlock(css, "@media (forced-colors: active)").slice(1, -1));
const forcedBodies = new Set(forced.map((rule) => rule.body));
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

describe.each([
  [".item-row-wanted", "dashed", "wanted"],
  [".item-row-ordered", "dotted", "ordered"],
])("%s (#42, D8)", (selector, style, status) => {
  const rule = only(RULES, selector);

  it(`draws a ${style} border in the ${status} color`, () => {
    expect(declaration(rule.body, "border-style")).toBe(style);
    expect(declaration(rule.body, "border-color")).toBe(`var(--${status})`);
  });

  it("is never faded by opacity or a filter, which would take the row's text under the contrast floor", () => {
    for (const r of RULES.filter((x) => x.selector.includes(selector))) {
      expect(declaration(r.body, "opacity"), r.selector).toBeUndefined();
      expect(declaration(r.body, "filter"), r.selector).toBeUndefined();
    }
  });

  it("keeps the border visible against the card and the page in both themes", () => {
    const border = token(declaration(rule.body, "border-color"));
    for (const [theme, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      expect(contrast(tokens[border] as string, tokens.card as string), `${theme} on card`).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
      expect(contrast(tokens[border] as string, tokens.paper as string), `${theme} on paper`).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    }
  });
});

describe("a wanted row's values (#42, D8)", () => {
  it("step back to muted ink, which still clears the text floor on the card in both themes", () => {
    const rule = only(RULES, ".item-row-wanted .item-field");
    const ink = token(declaration(rule.body, "color"));
    expect(ink).toBe("ink-muted");
    expect(contrast(light[ink] as string, light.card as string)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(dark[ink] as string, dark.card as string)).toBeGreaterThanOrEqual(TEXT);
  });
});

describe("forced colors (#42, D8)", () => {
  it("repaints the status borders in the system text color, keeping the dash and the dot", () => {
    for (const selector of [".item-row-wanted", ".item-row-ordered"]) {
      const rule = only(forced, selector);
      expect(declaration(rule.body, "border-color"), selector).toBe("CanvasText");
      expect(declaration(rule.body, "border-style"), selector).toBeUndefined();
    }
  });
});

describe("an item row at phone width (#42, R13)", () => {
  it("wraps its actions under its fields rather than squeezing them", () => {
    expect(declaration(only(RULES, ".item-row").body, "flex-wrap")).toBe("wrap");
    const fields = only(RULES, ".item-fields").body;
    expect(declaration(fields, "flex")).toBe("1 1 16rem");
    expect(declaration(fields, "min-width")).toBe("0");
  });

  it("lets the actions wrap among themselves, and a long value break, so nothing overflows the screen", () => {
    expect(declaration(only(RULES, ".item-actions").body, "flex-wrap")).toBe("wrap");
    expect(declaration(only(RULES, ".item-field").body, "overflow-wrap")).toBe("anywhere");
  });
});
