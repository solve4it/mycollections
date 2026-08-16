import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBlock, tokensFromBlock } from "../styles/wcag.js";
import { THEME_COLORS, THEME_PREFERENCES, THEME_STORAGE_KEY } from "./theme.js";

/**
 * The boot script in index.html is a deliberate duplicate of applyTheme(): a
 * module script cannot run before the first paint, so the storage key and the
 * light/dark mapping exist twice. This test executes the real script out of the
 * real index.html and fails the moment the two copies disagree — including on
 * the script's *shape*, since re-tagging it `type="module"` would reinstate the
 * flash while every behavioral assertion below stayed green.
 *
 * Named *.integration.test.ts because it reads files from disk with Node APIs
 * (same convention as tokens.integration.test.ts).
 */

// vitest runs with the package as cwd.
const html = readFileSync(resolve("index.html"), "utf8");
const css = readFileSync(resolve("src/styles/global.css"), "utf8");

const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
const bootTag = /<script(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/.exec(head);

function runBoot(storage: Pick<Storage, "getItem">): void {
  if (!bootTag?.groups?.body) throw new Error("no boot script found in the <head> of index.html");
  runInNewContext(bootTag.groups.body, { localStorage: storage, document });
}

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: (key) => (key === THEME_STORAGE_KEY ? value : null) };
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("theme boot script", () => {
  it("is present in the <head>", () => {
    expect(bootTag?.groups?.body?.trim()).toBeTruthy();
  });

  it("is render-blocking — not a module, not deferred, not async", () => {
    const attributes = bootTag?.groups?.attributes ?? "";
    expect(attributes).not.toMatch(/type\s*=/);
    expect(attributes).not.toMatch(/\bdefer\b/);
    expect(attributes).not.toMatch(/\basync\b/);
  });

  it("runs before the entry module and before the styles Vite injects", () => {
    // A build moves the stylesheet and the entry module into the end of <head>;
    // the boot script must stay ahead of both, which it does by sitting inside
    // <head> in source order.
    expect(head).toContain("<script");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("stamps a stored dark preference", () => {
    runBoot(storageWith("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("stamps a stored light preference", () => {
    runBoot(storageWith("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("leaves no attribute when nothing is stored", () => {
    runBoot(storageWith(null));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it.each(["system", "midnight", ""])("clears a stale attribute for %o rather than stamping it", (stored) => {
    document.documentElement.setAttribute("data-theme", "dark");
    runBoot(storageWith(stored));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("survives storage being denied and touches nothing", () => {
    expect(() =>
      runBoot({
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
      }),
    ).not.toThrow();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("never writes the stored value into markup", () => {
    const source = bootTag?.groups?.body ?? "";
    expect(source).not.toMatch(/document\.write|innerHTML|insertAdjacentHTML/);
  });

  it("uses the same storage key and values as lib/theme.ts", () => {
    const source = bootTag?.groups?.body ?? "";
    expect(source).toContain(`"${THEME_STORAGE_KEY}"`);
    for (const preference of THEME_PREFERENCES) {
      // "system" is the absence of an override, so only the explicit two are named.
      if (preference === "system") continue;
      expect(source).toContain(`"${preference}"`);
    }
  });
});

describe("theme-color meta tags", () => {
  const lightTokens = tokensFromBlock(extractBlock(css, ":root {"));
  const darkTokens = tokensFromBlock(extractBlock(css, "@media (prefers-color-scheme: dark)"));

  const metaTags = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((match) => match[0]);

  it("declares one meta per theme, tagged for applyTheme to find", () => {
    expect(metaTags).toHaveLength(2);
    expect(metaTags[0]).toContain('data-theme-color="light"');
    expect(metaTags[1]).toContain('data-theme-color="dark"');
  });

  it("tints the browser chrome with the same --paper the page paints", () => {
    expect(THEME_COLORS.light).toBe(lightTokens.paper);
    expect(THEME_COLORS.dark).toBe(darkTokens.paper);
    expect(metaTags[0]).toContain(`content="${lightTokens.paper}"`);
    expect(metaTags[1]).toContain(`content="${darkTokens.paper}"`);
  });
});
