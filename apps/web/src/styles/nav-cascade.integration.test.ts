import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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

interface Rule {
  selector: string;
  body: string;
}

/** Flatten a stylesheet to its style rules, in source order. */
function parseRules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;

    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close === -1) break;

    const prelude = text.slice(index, open).trim();
    const body = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      // Conditional groups contribute their children; @font-face and @keyframes
      // hold declarations rather than rules, so they contribute nothing.
      if (/^@(media|supports|layer)\b/.test(prelude)) out.push(...parseRules(body));
    } else {
      out.push({ selector: prelude, body });
    }
    index = close + 1;
  }
  return out;
}

const RULES = parseRules(css);

/** Selector specificity as [ids, classes/attrs/pseudo-classes, elements]. */
function specificity(selector: string): [number, number, number] {
  const withoutPseudoElements = selector.replace(/::[\w-]+/g, " ");
  const ids = withoutPseudoElements.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (withoutPseudoElements.match(/\.[\w-]+/g)?.length ?? 0) +
    (withoutPseudoElements.match(/\[[^\]]*\]/g)?.length ?? 0) +
    (withoutPseudoElements.match(/(^|[^:]):[\w-]+/g)?.length ?? 0);
  const elements = withoutPseudoElements.match(/(?:^|[\s>+~])([a-z][\w-]*)/g)?.length ?? 0;
  return [ids, classes, elements];
}

function declaration(body: string, property: string): string | undefined {
  const pattern = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "g");
  let value: string | undefined;
  for (const match of body.matchAll(pattern)) value = match[1];
  return value;
}

/** The declaration that actually wins for `element`, or undefined if none applies. */
function resolve_(element: Element, property: string, rules = RULES): string | undefined {
  const candidates = rules.flatMap((rule, order) =>
    rule.selector
      .split(",")
      .map((part) => part.trim())
      .filter((part) => {
        try {
          return element.matches(part);
        } catch {
          return false; // a selector jsdom cannot parse cannot match either
        }
      })
      .flatMap((part) => {
        const value = declaration(rule.body, property);
        return value === undefined ? [] : [{ value, order, weight: specificity(part) }];
      }),
  );

  return candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const diff = (a.weight[i] ?? 0) - (b.weight[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.order - b.order;
  })[candidates.length - 1]?.value;
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
      <button type="button" class="touch-target">Export data</button>
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

    // Sidebar: the active item is the one carrying a background.
    expect(resolve_(nav.sidebarActive, "background")).toBeDefined();
    expect(resolve_(nav.sidebarInactive, "background")).toBeUndefined();

    // Bottom nav: no fill on either, so emphasis is carried by color + weight.
    expect(resolve_(nav.bottomActive, "color")).toBe("var(--accent-text)");
    expect(resolve_(nav.bottomInactive, "color")).toBe("var(--color-text-muted)");
    // A hue change alone would fail WCAG 1.4.1 and disappear entirely in
    // forced-colors mode, so the active tab also carries a notch — pre-reserved
    // as a transparent border so becoming current costs no layout shift.
    expect(resolve_(nav.bottomInactive, "border-top")).toBe("2px solid transparent");
    expect(resolve_(nav.bottomActive, "border-top-color")).toBe("var(--accent-text)");
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
    expect(resolve_(nav.bottomInactive, "gap")).toBe("2px");
    expect(resolve_(nav.settingsButton, "gap")).toBe("8px");
    expect(resolve_(nav.sidebarInactive, "gap")).toBe("10px");
  });

  it("still gives an opted-in primary action its fill", () => {
    const nav = renderShell();
    expect(resolve_(nav.primaryCta, "background")).toBe("var(--color-primary)");
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
