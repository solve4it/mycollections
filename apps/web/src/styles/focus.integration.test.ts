import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";

/**
 * Where focus is drawn, and the one place it deliberately is not (#24).
 *
 * Reads global.css from disk like the other style tests: vitest stubs CSS
 * imports, and jsdom applies no stylesheet.
 */

const RULES = parseRules(readFileSync(resolve("src/styles/global.css"), "utf8"));

describe("focus indication", () => {
  it("rings everything that a keyboard can reach", () => {
    const matches = rulesFor(RULES, ":focus-visible");
    expect(matches, "the global focus ring must still exist").toHaveLength(1);
    const rule = matches[0];
    if (!rule) throw new Error("no :focus-visible rule");
    expect(declaration(rule.body, "outline")).toBe("2px solid var(--focus)");
  });

  it("does not ring the main landmark, which focus is moved to rather than tabbed to", () => {
    // The skip link and the route-change recovery both focus <main>, and a 2px
    // ring around a page-sized container is not an indicator: its top and right
    // edges are off screen, leaving a stray stripe down the sidebar seam. <main
    // tabindex="-1"> is programmatically focusable and not operable, so it is
    // not a user interface component and WCAG 2.4.7 does not ask for one.
    const matches = rulesFor(RULES, ".shell-main:focus");
    expect(matches, "main must opt out of the global ring explicitly").toHaveLength(1);
    const rule = matches[0];
    if (!rule) throw new Error("no .shell-main:focus rule");
    expect(declaration(rule.body, "outline")).toBe("none");
  });

  it("suppresses the ring on nothing else", () => {
    // A blanket `outline: none` is how an app loses every focus cue it has at
    // once, so the opt-out stays a list of one.
    const suppressed = RULES.filter((rule) => declaration(rule.body, "outline") === "none");
    expect(suppressed.map((rule) => rule.selector.trim())).toEqual([".shell-main:focus"]);
  });
});
