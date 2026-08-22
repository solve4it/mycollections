#!/usr/bin/env node
/**
 * Build-time guard: every doc must actually reach the published site with its
 * content (#294).
 *
 * Starlight catches an error thrown while rendering a page, logs it, and carries
 * on — the build finishes green and that page is published with its navigation,
 * header and footer intact and nothing in between. It reads as a real page, so
 * neither the build nor a glance at the site says anything is wrong.
 *
 * The check runs over the built HTML, because that is what gets deployed, and it
 * is driven from the content directory rather than from whatever happens to be
 * in `dist`: a source file that produced no page at all is the same failure as
 * one that produced an empty page, and only the source side can see it.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "../site.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");
const CONTENT_ROOT = resolve(__dirname, "../src/content/docs");
/** The shared docs, and where `copy-shared-docs.mjs` puts them. Kept in step with that script. */
const SHARED_DOCS = resolve(__dirname, "../../../docs");
const SHARED_DEST = join(CONTENT_ROOT, "user");
const SHARED_SKIP = new Set(["README.md"]);

/** Starlight renders every page's Markdown into this container. */
const CONTENT_REGION = /<div class="sl-markdown-content[^"]*"[^>]*>([\s\S]*?)<footer/;

async function contentFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await contentFiles(full)));
    else if (/\.mdx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** The same mapping the link rewrite uses: content path in, site path out. */
function builtPageFor(file) {
  const slug = relative(CONTENT_ROOT, file)
    .split(sep)
    .join(posix.sep)
    .replace(/\.mdx?$/, "")
    .replace(/(^|\/)index$/, "");
  return join(DIST, slug, "index.html");
}

const sources = await contentFiles(CONTENT_ROOT);
if (sources.length === 0) {
  console.error(`[check-built-pages] no content found in ${CONTENT_ROOT} — did the copy step run?`);
  process.exit(1);
}

// Checking only what reached the content directory would miss the copy step
// failing: the site still builds, the splash page still has a body, and the
// entire user guide is quietly absent from the deploy.
const notCopied = [];
for (const entry of await readdir(SHARED_DOCS, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".md") || SHARED_SKIP.has(entry.name)) continue;
  if (!sources.includes(join(SHARED_DEST, entry.name))) notCopied.push(`docs/${entry.name}`);
}
if (notCopied.length > 0) {
  console.error(`[check-built-pages] ${notCopied.length} shared doc(s) never reached the site:`);
  for (const line of notCopied.sort()) console.error(`  ${line}`);
  console.error("  → scripts/copy-shared-docs.mjs runs as `prebuild`; it did not copy these.");
  process.exit(1);
}

const missing = [];
const empty = [];

for (const source of sources) {
  const page = builtPageFor(source);
  let html;
  try {
    html = await readFile(page, "utf8");
  } catch {
    missing.push(`${relative(CONTENT_ROOT, source)} → ${relative(DIST, page)}`);
    continue;
  }
  const rendered = html.match(CONTENT_REGION)?.[1] ?? "";
  // Whitespace only is what a failed render leaves behind. A page with a real
  // body always carries at least one element.
  if (!/<\w/.test(rendered)) empty.push(`${relative(CONTENT_ROOT, source)} → ${relative(DIST, page)}`);
}

if (missing.length > 0 || empty.length > 0) {
  if (missing.length > 0) {
    console.error(`[check-built-pages] ${missing.length} doc(s) produced no page:`);
    for (const line of missing.sort()) console.error(`  ${line}`);
  }
  if (empty.length > 0) {
    console.error(`[check-built-pages] ${empty.length} doc(s) were published with an empty body:`);
    for (const line of empty.sort()) console.error(`  ${line}`);
    console.error("  → the page failed to render. Starlight logs that error above and exits 0,");
    console.error("    so this is the only thing standing between it and the published site.");
  }
  process.exit(1);
}

console.log(`[check-built-pages] ${sources.length} doc(s) built with content, served under ${BASE}/.`);
