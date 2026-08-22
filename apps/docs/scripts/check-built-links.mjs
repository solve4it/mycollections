#!/usr/bin/env node
/**
 * Build-time guard for the shared user docs (#286).
 *
 * `docs/*.md` is read in two places: on GitHub, where `[Items](./items.md)` is
 * the correct form, and by this Starlight site, where that href has to become a
 * real page URL. The rewrite happens in the plugin registered in `astro.config.mjs`,
 * and this script is what stops it from silently regressing — a link form the
 * plugin does not recognize would otherwise ship as a 404 that nothing fails on.
 *
 * Two checks, both over the built HTML rather than the source, because the built
 * HTML is what actually gets published:
 *
 *   1. No in-site href still points at a `.md` file.
 *   2. Every in-site href resolves to a page that was actually built — which is
 *      what catches a rewrite that drops or doubles the `base` prefix.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "../site.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");

/** Link and asset URLs, unescaped enough for the shapes an Astro build emits. */
function extractLinks(html) {
  return [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1].replaceAll("&#38;", "&"));
}

function isExternal(link) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link);
}

async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith(".html")) found.push(full);
  }
  return found;
}

const files = await htmlFiles(DIST);
if (files.length === 0) {
  console.error(`[check-built-links] no HTML found in ${DIST} — was the site built?`);
  process.exit(1);
}

/** Every path the build actually produced, as the URL that serves it. */
const built = new Set(
  files.map((file) => {
    const path = file.slice(DIST.length).replaceAll("\\", "/");
    return path.replace(/index\.html$/, "").replace(/\.html$/, "");
  }),
);

const markdownLinks = [];
const dangling = [];

for (const file of files) {
  const from = file.slice(DIST.length + 1);
  for (const link of extractLinks(await readFile(file, "utf8"))) {
    if (isExternal(link)) continue;
    const path = link.split(/[#?]/)[0];
    if (path === "") continue;
    if (/\.mdx?$/.test(path)) {
      markdownLinks.push(`${from} → ${link}`);
      continue;
    }
    // Only page links are checked; assets are emitted by the build itself.
    if (!path.startsWith("/") || /\.[a-z0-9]+$/i.test(path)) continue;
    const url = new URL(path, "https://example.com").pathname;
    const withoutBase = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    if (!built.has(withoutBase) && !built.has(`${withoutBase}/`)) {
      dangling.push(`${from} → ${link}`);
    }
  }
}

if (markdownLinks.length > 0 || dangling.length > 0) {
  if (markdownLinks.length > 0) {
    console.error(`[check-built-links] ${markdownLinks.length} link(s) still point at a Markdown file:`);
    for (const line of markdownLinks.sort()) console.error(`  ${line}`);
    console.error("  → either the target file does not exist, or the rewrite in");
    console.error("    scripts/satteri-relative-doc-links.mjs did not recognize this link form.");
  }
  if (dangling.length > 0) {
    console.error(`[check-built-links] ${dangling.length} in-site link(s) point at a page that was not built:`);
    for (const line of dangling.sort()) console.error(`  ${line}`);
    console.error("  → usually a missing or doubled `base` prefix.");
  }
  process.exit(1);
}

console.log(`[check-built-links] ${files.length} page(s) checked, all in-site links resolve.`);
