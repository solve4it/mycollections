/**
 * WCAG contrast math and the token plumbing the style tests need to compute it
 * from global.css. Lives in one place so `tokens.integration.test.ts` (are the
 * palette pairs legible?) and `nav-cascade.integration.test.ts` (does the UI
 * actually resolve to those pairs?) cannot drift apart on the arithmetic.
 *
 * Test-only: nothing in the app imports this, so it never reaches the bundle.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** All six-digit-hex custom property declarations in a CSS block. */
export function tokensFromBlock(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value;
  }
  return tokens;
}

/**
 * Every `--name: <value>` in a block, including aliases whose value is another
 * `var()`. `resolveColor` follows those chains; `tokensFromBlock` deliberately
 * does not see them, because the palette test asserts on literal hex.
 */
export function declarationsFromBlock(block: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) declarations[name] = value.trim();
  }
  return declarations;
}

/** The brace-balanced block that follows `opener` in `source`. */
export function extractBlock(source: string, opener: string): string {
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

export function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Composite a translucent color over an opaque one (simple alpha blend). */
export function over(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return {
    r: alpha * foreground.r + (1 - alpha) * background.r,
    g: alpha * foreground.g + (1 - alpha) * background.g,
    b: alpha * foreground.b + (1 - alpha) * background.b,
  };
}

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Rgb | string): number {
  const { r, g, b } = typeof color === "string" ? toRgb(color) : color;
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrast(foreground: Rgb | string, background: Rgb | string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA floors. */
export const TEXT = 4.5;
export const NON_TEXT = 3.0;

/**
 * Resolve a CSS color value against a token table, following `var()` chains and
 * blending `color-mix(in srgb, <color> N%, transparent)` over `backdrop`. Those
 * are the only two forms the stylesheet uses; anything else returns undefined
 * rather than guessing, so a caller can fail loudly instead of silently passing.
 */
export function resolveColor(
  value: string | undefined,
  tokens: Record<string, string>,
  backdrop?: Rgb,
  depth = 0,
): Rgb | undefined {
  if (value === undefined || depth > 10) return undefined;
  const input = value.trim();

  if (/^#[0-9a-fA-F]{6}$/.test(input)) return toRgb(input);

  const variable = input.match(/^var\(\s*--([a-z-]+)\s*\)$/);
  if (variable?.[1]) {
    const token = tokens[variable[1]];
    return token === undefined ? undefined : resolveColor(token, tokens, backdrop, depth + 1);
  }

  const mix = input.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/);
  if (mix?.[1] && mix[2] && backdrop) {
    const base = resolveColor(mix[1], tokens, backdrop, depth + 1);
    return base === undefined ? undefined : over(base, Number(mix[2]) / 100, backdrop);
  }

  return undefined;
}
