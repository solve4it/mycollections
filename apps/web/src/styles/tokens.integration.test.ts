import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

function tokensFromBlock(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value;
  }
  return tokens;
}

function extractBlock(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`Block not found: ${opener}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`Unbalanced block: ${opener}`);
}

const lightTokens = tokensFromBlock(extractBlock(css, ":root {"));
const darkTokens = {
  ...lightTokens,
  ...tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)")),
};

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = srgbChannel((n >> 16) & 0xff);
  const g = srgbChannel((n >> 8) & 0xff);
  const b = srgbChannel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgHex: string, bgHex: string): number {
  const [hi, lo] = [luminance(fgHex), luminance(bgHex)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3.0;

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
