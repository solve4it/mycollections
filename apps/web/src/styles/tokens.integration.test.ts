import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, extractBlock, NON_TEXT, TEXT, tokensFromBlock } from "./wcag.js";

/**
 * Guards the Cabinet & Paper palette against contrast regressions: every
 * foreground/background pair actually used by the UI must clear WCAG AA
 * (4.5:1 for text, 3:1 for meaningful non-text UI) in BOTH themes.
 * The CSS itself is the source of truth — this test parses global.css.
 *
 * Named *.integration.test.ts because it reads the stylesheet from disk with
 * Node APIs (vitest stubs CSS imports, so importing it is not an option); that
 * pattern keeps node-context tests out of the browser-targeted typecheck.
 */

// vitest runs with the package as cwd (same convention as api-client.integration.test.ts).
const css = readFileSync(resolve("src/styles/global.css"), "utf8");

const lightTokens = tokensFromBlock(extractBlock(css, ":root {"));
const darkTokens = {
  ...lightTokens,
  ...tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)")),
};

/** [foreground token, background token, minimum ratio, what the pair is]. */
const PAIRS: Array<[string, string, number, string]> = [
  ["ink", "paper", TEXT, "body text on page background"],
  ["ink", "card", TEXT, "body text on cards"],
  ["ink-muted", "paper", TEXT, "secondary text on page background"],
  ["ink-muted", "card", TEXT, "secondary text on cards"],
  ["stamp-ink", "stamp", TEXT, "primary button label"],
  ["accent-text", "paper", TEXT, "accent-colored text on page background"],
  ["accent-text", "card", TEXT, "accent-colored text on cards"],
  ["cabinet-ink", "cabinet", TEXT, "active nav text"],
  ["cabinet-muted", "cabinet", TEXT, "inactive nav text"],
  ["manila", "cabinet", TEXT, "manila used as text on the cabinet (bottom-nav active)"],
  ["owned", "card", TEXT, "owned status label (small text)"],
  ["wanted", "card", TEXT, "wanted status label (small text)"],
  ["ordered", "card", TEXT, "ordered status label (small text)"],
  ["owned", "paper", TEXT, "owned status label on page background"],
  ["wanted", "paper", TEXT, "wanted status label on page background"],
  ["ordered", "paper", TEXT, "ordered status label on page background"],
  ["focus", "paper", NON_TEXT, "focus ring on page background"],
  ["focus", "card", NON_TEXT, "focus ring on cards"],
  ["focus-on-cabinet", "cabinet", NON_TEXT, "focus ring on the cabinet nav"],
  ["manila", "cabinet", NON_TEXT, "active notch on the cabinet"],
  ["progress", "card", NON_TEXT, "progress fill on cards"],
  ["progress", "line", NON_TEXT, "progress fill against its track"],
  ["danger", "paper", TEXT, "error text on page background"],
  ["danger", "card", TEXT, "error text on cards"],
  ["danger", "danger-surface", TEXT, "error text on its own tinted strip"],
  ["ink", "danger-surface", TEXT, "body text inside a tinted strip"],
  // The strip's border, not its tint, is what marks a failure without relying on
  // hue: --danger-surface is ~1.05:1 against both surfaces by design (a tint
  // readable enough to clear 3:1 would not be a tint), so it is decoration and
  // deliberately absent from this list.
  ["danger", "paper", NON_TEXT, "error strip border on page background"],
];

describe.each([
  ["light", lightTokens],
  ["dark", darkTokens],
])("%s palette contrast (WCAG AA)", (_theme, tokens) => {
  it("defines every token the pair list needs", () => {
    const needed = new Set<string>();
    for (const [fg, bg] of PAIRS) {
      needed.add(fg);
      needed.add(bg);
    }
    for (const name of needed) {
      expect(tokens[name], `--${name} must be a 6-digit hex in global.css`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(PAIRS)("--%s on --%s ≥ %s:1 (%s)", (fg, bg, minimum) => {
    const fgHex = tokens[fg];
    const bgHex = tokens[bg];
    if (!fgHex || !bgHex) throw new Error(`missing token: --${fg} or --${bg}`);
    const ratio = contrast(fgHex, bgHex);
    expect(ratio, `--${fg} (${fgHex}) on --${bg} (${bgHex}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
  });
});

describe("dark palette overrides", () => {
  it("data-theme=dark block matches the media-query dark block", () => {
    const mediaDark = tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)"));
    const attrDark = tokensFromBlock(extractBlock(css, ':root[data-theme="dark"]'));
    expect(attrDark).toEqual(mediaDark);
  });

  it("data-theme=light block restores every light value the dark block overrides", () => {
    const mediaDark = tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)"));
    const attrLight = tokensFromBlock(extractBlock(css, ':root[data-theme="light"]'));
    for (const name of Object.keys(mediaDark)) {
      expect(attrLight[name], `--${name} must be restored in [data-theme="light"]`).toBe(lightTokens[name]);
    }
  });
});
