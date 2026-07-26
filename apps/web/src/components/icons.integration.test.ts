import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Acceptance guard for #221: no unicode glyph icons remain in the UI. Glyphs
 * render in whatever the platform font happens to have, ignore the stroke
 * weight of the Cabinet & Paper direction, and are announced by screen readers
 * under names nobody chose ("cross mark"). The `Icon` component replaces them.
 *
 * Named *.integration.test.ts because it walks the source tree with Node APIs;
 * that suffix keeps node-context files out of the browser-targeted typecheck.
 */

/** Blocks that only ever hold pictographs in this codebase. Punctuation
 *  (U+2000–U+206F: the em dash, curly quotes) is deliberately not listed. */
const GLYPH_RANGES = [
  [0x2190, 0x21ff, "arrows"],
  [0x2200, 0x22ff, "mathematical operators"],
  [0x2300, 0x23ff, "miscellaneous technical"],
  [0x25a0, 0x25ff, "geometric shapes"],
  [0x2600, 0x27bf, "miscellaneous symbols and dingbats"],
  [0x2b00, 0x2bff, "miscellaneous symbols and arrows"],
  [0x1f300, 0x1faff, "emoji"],
] as const;

function blockOf(codePoint: number): string | undefined {
  return GLYPH_RANGES.find(([lo, hi]) => codePoint >= lo && codePoint <= hi)?.[2];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(tsx?|css|json)$/.test(entry.name)) return [];
    // Tests and this guard describe glyphs; only shipped UI source is scanned.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

interface Offense {
  file: string;
  line: number;
  glyph: string;
  block: string;
}

function findGlyphs(root: string): Offense[] {
  const offenses: Offense[] = [];
  for (const file of sourceFiles(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const glyph of text) {
        const block = blockOf(glyph.codePointAt(0) ?? 0);
        if (block) offenses.push({ file: relative(root, file), line: index + 1, glyph, block });
      }
    });
  }
  return offenses;
}

describe("no unicode glyph icons in the UI source", () => {
  it("finds none under src/", () => {
    const offenses = findGlyphs(resolve("src"));
    const report = offenses.map((o) => `${o.file}:${o.line} "${o.glyph}" (${o.block}) — use <Icon /> instead`);
    expect(report).toEqual([]);
  });

  it("detects a glyph when one is present (the guard actually works)", () => {
    // U+2699 GEAR, the glyph this issue removed from the nav.
    expect(blockOf(0x2699)).toBe("miscellaneous symbols and dingbats");
    // U+2014 EM DASH stays legal: it is punctuation, not an icon.
    expect(blockOf(0x2014)).toBeUndefined();
  });
});
