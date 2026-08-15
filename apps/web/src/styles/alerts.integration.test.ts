import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { declaration, parseRules, rulesFor } from "./css-rules.js";

/**
 * Failure surfaces (#264). Every error in the app is a `[role="alert"]` node, so
 * the treatment attaches to the role rather than to a class each route has to
 * remember to apply — these assertions pin that it stays that way, and that the
 * strip is drawn with a border rather than by hue alone.
 *
 * Reads global.css from disk like the other style tests: vitest stubs CSS
 * imports, and jsdom applies no stylesheet.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");
const RULES = parseRules(css);

function only(selector: string) {
  const matches = rulesFor(RULES, selector);
  expect(matches, `global.css must declare exactly one \`${selector}\` rule`).toHaveLength(1);
  const rule = matches[0];
  if (!rule) throw new Error(`no rule for ${selector}`);
  return rule;
}

describe("alert styling", () => {
  it("writes every alert in danger ink, whatever element carries the role", () => {
    // Attached to the role, not a class: eleven alert sites across five routes
    // pick the treatment up at once, and a new route cannot forget it.
    expect(declaration(only('[role="alert"]').body, "color")).toBe("var(--danger)");
  });

  it("gives a standalone alert a border, not just a color", () => {
    // WCAG 1.4.1: hue alone is not a cue. It matters more than usual here —
    // --danger and --wanted are both warm and are indistinguishable to a
    // deuteranope, so the border is what actually marks this as a failure.
    const strip = only('p[role="alert"]');
    expect(declaration(strip.body, "border-left")).toBe("3px solid var(--danger)");
    expect(declaration(strip.body, "background")).toBe("var(--danger-surface)");
    expect(declaration(strip.body, "padding")).toBeDefined();
  });

  it("keeps a page-level alert's explanation calm while its title carries the failure", () => {
    // Verified against the running app: the whole block in danger red made
    // "Your collections are safe…" read as an alarm. The title stays danger by
    // inheritance; only the trailing explanation drops to muted body ink, which
    // works for both shapes — <h1> + <p>, and the region alert's <p> + <p>.
    expect(declaration(only('div[role="alert"] > p:last-of-type').body, "color")).toBe("var(--ink-muted)");
  });

  it("does not give the strip treatment to page-level alerts", () => {
    // <div role="alert"> owns the whole screen; a tinted strip stretched across
    // it reads as an inline warning that grew. Only <p role="alert"> is a strip.
    for (const rule of RULES.filter((r) => /\[role="alert"\]/.test(r.selector))) {
      if (rule.selector.trim() === 'p[role="alert"]') continue;
      expect(declaration(rule.body, "background"), `${rule.selector} must not paint a strip`).toBeUndefined();
      expect(declaration(rule.body, "border-left"), `${rule.selector} must not draw a strip border`).toBeUndefined();
    }
  });

  it("leaves the status role alone — progress is not a failure", () => {
    // role="status" carries loading and success messages (import pending,
    // import succeeded). Danger styling on those would be a lie.
    for (const rule of RULES.filter((r) => /\[role="status"\]/.test(r.selector))) {
      expect(declaration(rule.body, "color"), `${rule.selector} must not use danger ink`).not.toBe("var(--danger)");
    }
  });
});

describe("danger tokens", () => {
  const BLOCKS = [
    ":root {",
    "@media (prefers-color-scheme: dark)",
    ':root[data-theme="dark"]',
    ':root[data-theme="light"]',
  ];

  it("are declared as literal hex in every theme block", () => {
    // Not color-mix(): tokensFromBlock reads only 6-digit hex, so a computed
    // value would be invisible to the palette and light/dark parity tests and
    // the three blocks could silently drift apart.
    for (const block of BLOCKS) {
      const start = css.indexOf(block);
      const body = css.slice(start, css.indexOf("}", start));
      for (const token of ["--danger", "--danger-surface"]) {
        expect(body, `${block} must declare ${token} as hex`).toMatch(
          new RegExp(`${token}:\\s*#[0-9a-f]{6}\\s*;`, "i"),
        );
      }
    }
  });
});
