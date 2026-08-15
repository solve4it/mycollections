import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRules, type Rule, winningDeclaration } from "./css-rules.js";
import { contrast, declarationsFromBlock, extractBlock, type Rgb, resolveColor, TEXT, toHex } from "./wcag.js";

/**
 * `tokens.integration.test.ts` proves the palette pairs clear WCAG AA. It cannot
 * prove the UI actually *uses* those pairs, and #259 is exactly that gap: every
 * palette pair passed while the active bottom-nav item rendered
 * `var(--color-primary)` on `var(--color-primary)` — 1.00:1, an invisible tab —
 * because `a.touch-target` was declared later than `.bottom-nav-item` at equal
 * specificity and quietly won the cascade.
 *
 * So this test resolves the cascade itself: it parses global.css, matches every
 * rule against a real DOM copy of the shell, orders the matches by specificity
 * then source order, and asserts which declaration actually wins. The pairs it
 * pins (`--accent-text`/`--ink-muted` on `--paper`) are the ones the palette test
 * already holds to 4.5:1, so together the two files cover "correct colors" and
 * "colors correctly applied".
 *
 * Named *.integration.test.ts because it reads the stylesheet from disk with Node
 * APIs (vitest stubs CSS imports), matching tokens.integration.test.ts.
 */

const css = readFileSync(resolve("src/styles/global.css"), "utf8");

const RULES = parseRules(css);

/** Thin wrapper so the existing assertions keep reading against the full sheet. */
function resolve_(element: Element, property: string, rules: Rule[] = RULES, pseudo?: string): string | undefined {
  return winningDeclaration(element, property, rules, pseudo);
}

/** The shell, as Shell.tsx renders it. */
function renderShell() {
  document.body.innerHTML = `
    <div class="shell">
      <nav class="shell-sidebar">
        <div class="sidebar-nav">
          <a class="touch-target" data-status="active" href="/collections">Collections</a>
          <a class="touch-target" href="/settings">Settings</a>
        </div>
      </nav>
      <main class="shell-main"></main>
    </div>
    <nav class="shell-bottom-nav">
      <a class="bottom-nav-item touch-target" data-status="active" href="/collections"><span>Collections</span></a>
      <a class="bottom-nav-item touch-target" href="/settings"><span>Settings</span></a>
    </nav>
    <section class="settings-data">
      <button type="button" class="touch-target button-quiet">Export data</button>
    </section>
    <div class="page-header">
      <a class="touch-target button-primary" href="/collections/new">Create collection</a>
    </div>`;

  const pick = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`fixture is missing ${selector}`);
    return element;
  };

  return {
    sidebarActive: pick('.sidebar-nav a[data-status="active"]'),
    sidebarInactive: pick(".sidebar-nav a:not([data-status])"),
    bottomActive: pick('.shell-bottom-nav a[data-status="active"]'),
    bottomInactive: pick(".shell-bottom-nav a:not([data-status])"),
    settingsButton: pick(".settings-data button"),
    primaryCta: pick("a.button-primary"),
    sidebar: pick(".shell-sidebar"),
    bottomNav: pick(".shell-bottom-nav"),
  };
}

const PRIMARY_FILL = /--color-primary|--stamp\b/;

// Aliases (--color-bg: var(--paper)) matter here, so read every custom property
// rather than only the literal-hex palette entries.
const lightTokens = declarationsFromBlock(extractBlock(css, ":root {"));
const darkTokens = {
  ...lightTokens,
  ...declarationsFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)")),
};

/**
 * The color a nav link's text and background actually paint to. Comparing the
 * *resolved* colors is the whole point: the #259 bug was `var(--accent-text)` on
 * `var(--color-primary)` — two different token names that are both #3e46c8, so
 * any check on token names alone would have called it fine.
 */
function paintedColors(link: Element, tokens: Record<string, string>) {
  const backdrop = (element: Element | null): Rgb => {
    for (let node = element; node; node = node.parentElement) {
      const declared = resolve_(node, "background") ?? resolve_(node, "background-color");
      const painted = resolveColor(declared, tokens, backdrop(node.parentElement));
      if (painted) return painted;
    }
    // Nothing painted: the page background shows through.
    const page = resolveColor("var(--color-bg)", tokens);
    if (!page) throw new Error("--color-bg must resolve");
    return page;
  };

  const background = backdrop(link);
  const foreground = resolveColor(resolve_(link, "color"), tokens, background);
  if (!foreground) throw new Error(`could not resolve the text color of ${link.className}`);
  return { foreground, background, ratio: contrast(foreground, background) };
}

describe.each([
  ["light", lightTokens],
  ["dark", darkTokens],
])("nav contrast in the %s theme", (_theme, tokens) => {
  it.each([["sidebarActive"], ["sidebarInactive"], ["bottomActive"], ["bottomInactive"]] as const)(
    "%s clears WCAG AA against the surface it actually sits on",
    (which) => {
      const link = renderShell()[which];
      const { foreground, background, ratio } = paintedColors(link, tokens);
      expect(
        ratio,
        `${which}: ${toHex(foreground)} on ${toHex(background)} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(TEXT);
    },
  );
});

describe("nav cascade", () => {
  it("keeps the primary-button fill out of the navigation", () => {
    const nav = renderShell();
    for (const link of [nav.sidebarInactive, nav.bottomInactive, nav.bottomActive]) {
      const background = resolve_(link, "background") ?? resolve_(link, "background-color");
      expect(background ?? "none", `an inactive/bottom nav link must not take the primary fill`).not.toMatch(
        PRIMARY_FILL,
      );
    }
  });

  it("emphasizes the active item, not the inactive one", () => {
    const nav = renderShell();

    // Sidebar: the active item is the one carrying the pill.
    expect(resolve_(nav.sidebarActive, "background")).toBeDefined();
    expect(resolve_(nav.sidebarInactive, "background")).toBeUndefined();
    expect(resolve_(nav.sidebarActive, "color")).toBe("var(--cabinet-ink)");
    expect(resolve_(nav.sidebarInactive, "color")).toBe("var(--cabinet-muted)");
    expect(Number(resolve_(nav.sidebarActive, "font-weight"))).toBeGreaterThan(
      Number(resolve_(nav.sidebarInactive, "font-weight")),
    );

    // Bottom nav: manila carries the active state on the cabinet surface.
    expect(resolve_(nav.bottomActive, "color")).toBe("var(--manila)");
    expect(resolve_(nav.bottomInactive, "color")).toBe("var(--cabinet-muted)");
  });

  it("puts the whole nav on the cabinet surface, in both themes", () => {
    const nav = renderShell();
    expect(resolve_(nav.sidebar, "background")).toBe("var(--cabinet)");
    expect(resolve_(nav.bottomNav, "background")).toBe("var(--cabinet)");
    // The cabinet is dark in BOTH themes, so it must not be built from an alias
    // that flips with the palette.
    for (const link of [nav.sidebarActive, nav.sidebarInactive, nav.bottomActive, nav.bottomInactive]) {
      expect(resolve_(link, "color")).toMatch(/--cabinet-|--manila/);
    }
  });

  it("marks the active sidebar item with a manila notch", () => {
    renderShell();
    // The notch is drawn on ::before, which no DOM query can see — assert on the
    // rule itself, and on the fact that it is manila rather than a hue reused
    // from the paper palette.
    const notch = RULES.find((rule) => /\.sidebar-nav a\[data-status="active"\]::before/.test(rule.selector));
    expect(notch, "the active sidebar item must draw a ::before notch").toBeDefined();
    expect(notch?.body).toMatch(/background:\s*var\(--manila\)/);
    expect(notch?.body).toMatch(/width:\s*3px/);
  });

  it("uses the on-cabinet focus ring, never the paper one, on cabinet surfaces", () => {
    const nav = renderShell();
    // --stamp on --cabinet measures 2.02:1 in light mode, under the 3:1 floor for
    // non-text UI. --focus-on-cabinet exists for exactly this surface.
    for (const link of [nav.sidebarActive, nav.sidebarInactive, nav.bottomActive, nav.bottomInactive]) {
      const outline = resolve_(link, "outline", RULES, ":focus-visible");
      expect(outline, "every cabinet nav link needs a visible focus ring").toBeDefined();
      expect(outline).toContain("var(--focus-on-cabinet)");
      expect(outline).not.toContain("var(--focus)");
    }
  });

  it("lets the bottom nav keep its own small label size", () => {
    const nav = renderShell();
    // `font: inherit` from a button skin would silently reset this to 1rem.
    expect(resolve_(nav.bottomInactive, "font-size")).toBe("0.75rem");
    expect(resolve_(nav.bottomInactive, "font")).toBeUndefined();
  });

  it("lets each component own its icon gap rather than inheriting one", () => {
    const nav = renderShell();
    // Moving `gap` onto the sizing utility is what made the bottom nav space its
    // icon like a button; moving it off is what silently closed the gap on the
    // settings buttons. Both directions are pinned here.
    expect(resolve_(nav.bottomInactive, "gap")).toBe("3px");
    // The settings button's gap moved from a .settings-data positional rule onto
    // the .button-quiet skin it now opts into (#224). Same principle, one owner:
    // the gap belongs to the button, not to where the button happens to sit.
    expect(resolve_(nav.settingsButton, "gap")).toBe("var(--space-2)");
    expect(resolve_(nav.sidebarInactive, "gap")).toBe("11px");
  });

  it("still gives an opted-in primary action its fill", () => {
    const nav = renderShell();
    // Matched rather than compared to one spelling: #224 migrates the skin off
    // the --color-primary alias onto --stamp, and both are the same fill. What
    // this test is actually for is that the fill reaches the opted-in CTA and
    // nothing else — PRIMARY_FILL accepts either name and the nav assertions
    // above still prove it stays out of the navigation.
    expect(resolve_(nav.primaryCta, "background")).toMatch(PRIMARY_FILL);
    expect(resolve_(nav.primaryCta, "color")).toBe("var(--stamp-ink)");
  });

  it("detects a leak when one exists (the resolver actually works)", () => {
    const nav = renderShell();
    // The exact shape of the #259 bug: a later, equal-specificity rule.
    const buggy = parseRules(`
      .bottom-nav-item { color: var(--color-text-muted); }
      a.touch-target { background: var(--color-primary); color: var(--stamp-ink); }
    `);
    expect(resolve_(nav.bottomInactive, "background", buggy)).toBe("var(--color-primary)");
    expect(resolve_(nav.bottomInactive, "color", buggy)).toBe("var(--stamp-ink)");
  });
});
