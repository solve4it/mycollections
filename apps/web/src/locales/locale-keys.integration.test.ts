import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `t("key")` in the app resolves to a real string in the namespace its
 * `useTranslation` asked for (#347).
 *
 * i18next's default for a missing key is to render the key itself, so the
 * failure mode is a screen with `back_to_collections` printed on it where a
 * label should be — which is exactly what `routes/collections/edit.tsx` shipped.
 * Nothing catches that at runtime: it is not an error, not a warning in the
 * production build, and a test that asserts an element is present sees a
 * perfectly good element with the wrong words in it.
 *
 * The near miss is worse than the miss. The same file also rendered the
 * *dashboard's* copy for a single collection, because `error_title` exists in
 * both namespaces and means different things in each. This test cannot see that
 * one — a key that resolves is a key that resolves — which is why every failure
 * surface is also asserted on its words. What this catches is the half that no
 * amount of reading spots.
 *
 * Named *.integration.test.ts because it walks the source tree with Node APIs;
 * that suffix keeps node-context files out of the browser-targeted typecheck.
 */

const SRC = resolve("src");
const LOCALES = resolve("src/locales/en");

/** The namespace files, as i18next loads them. */
function loadNamespaces(): Map<string, Set<string>> {
  const namespaces = new Map<string, Set<string>>();
  for (const file of readdirSync(LOCALES).filter((name) => name.endsWith(".json"))) {
    const json = JSON.parse(readFileSync(join(LOCALES, file), "utf8")) as Record<string, unknown>;
    namespaces.set(file.replace(/\.json$/, ""), new Set(Object.keys(json)));
  }
  return namespaces;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) return [];
    if (entry.name.includes(".test.")) return [];
    return [path];
  });
}

/**
 * `const { t } = useTranslation("items")` and its renamed form,
 * `const { t: tCollections } = useTranslation("collections")` — which is how a
 * screen reaches a second namespace, and where the confusion starts.
 */
const BINDING = /const\s*\{\s*t(?::\s*(\w+))?\s*\}\s*=\s*useTranslation\("(\w+)"\)/g;

/** A call through one of those bindings. Namespaced keys ("collections:title") resolve themselves. */
const CALL = /\b(t[A-Z]\w*|t)\(\s*"([\w.]+)"/g;

/**
 * A count makes i18next look for the plural suffixes instead of the bare key —
 * `items_count_one` / `items_count_other` — so the bare key is absent by design.
 * English has these two; a language with more declares them in its own file.
 */
const PLURAL_SUFFIXES = ["_one", "_other"];

function resolves(keys: Set<string>, key: string): boolean {
  return keys.has(key) || PLURAL_SUFFIXES.every((suffix) => keys.has(key + suffix));
}

describe("translation keys", () => {
  const namespaces = loadNamespaces();

  it("has namespace files to check against", () => {
    // Guards the guard: a rename that empties this map would make every
    // assertion below vacuously true.
    expect([...namespaces.keys()].sort()).toEqual(["collections", "common", "items", "settings", "setup"]);
  });

  it("resolves every key the app asks for, in the namespace it asks in", () => {
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const bindings = new Map<string, string>();
      for (const [, alias, namespace] of source.matchAll(BINDING)) bindings.set(alias ?? "t", namespace);
      if (bindings.size === 0) continue;

      for (const match of source.matchAll(CALL)) {
        const [, alias, key] = match;
        const namespace = alias ? bindings.get(alias) : undefined;
        if (!namespace || !key || key.includes(":")) continue;

        const keys = namespaces.get(namespace);
        if (keys && resolves(keys, key)) continue;

        const line = source.slice(0, match.index).split("\n").length;
        const elsewhere = [...namespaces].filter(([, k]) => resolves(k, key)).map(([name]) => name);
        const where = elsewhere.length > 0 ? `it is in ${elsewhere.join(", ")}` : "it is in no namespace";
        missing.push(`${relative(SRC, file)}:${line} — ${alias}("${key}") reads "${namespace}", but ${where}`);
      }
    }

    expect(missing, "i18next renders a missing key as the key, so these print raw on screen").toEqual([]);
  });
});
