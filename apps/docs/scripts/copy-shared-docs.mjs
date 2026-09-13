#!/usr/bin/env node
/**
 * Copies the shared user docs into this site's content collection.
 *
 * `docs/` at the repo root is the single source for the user guide; this puts a
 * generated copy where Starlight's content loader can see it, as `predev` and
 * `prebuild`. `README.md` there is maintainer notes about the directory itself,
 * not a page, so it stays behind.
 *
 * `docs/assets/` comes too, and that part is not cosmetic (#295). The authoring
 * rule in `docs/README.md` is to reference images relatively — `![Shelf](./assets/shelf.png)`
 * — which GitHub resolves against the source file. Astro resolves it against the
 * *copied* file, through its image pipeline, and fails the build outright if the
 * image is not sitting next to that copy. So the directory has to travel with
 * the Markdown, keeping its internal shape, or the first image anyone adds by
 * the documented rule breaks the build.
 *
 * Only `assets/` is recursed into: it is the one subdirectory the authoring
 * rules give a meaning to. Sibling Markdown is still taken from the top level
 * alone (see `check-built-pages.mjs`, which verifies exactly that set arrived).
 *
 * Markdown anywhere else under `docs/` throws rather than being passed over
 * (#331). Publishing it instead would only move the silence: the sidebar in
 * `astro.config.mjs` is written by hand, so a nested page would reach the site
 * and still be reachable by nothing. Until nested sections are added
 * deliberately — sidebar included — the honest behavior is to stop the build
 * and name the file, so the author who follows the old layout hint in
 * `docs/README.md` hears about it on the first run instead of shipping nothing.
 */
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../../docs");
const DEST = resolve(__dirname, "../src/content/docs/user");
const SKIP = new Set(["README.md"]);
/** The one directory under `docs/` that is copied wholesale. Named in `docs/README.md`. */
export const ASSETS_DIR = "assets";
const MARKDOWN = /\.mdx?$/;

/**
 * Collects the Markdown under a directory, relative to `docs/`, deepest paths
 * included. Only used for the directories that are *not* copied, to say what is
 * being left out.
 */
async function nestedMarkdown(dir, prefix) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const label = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await nestedMarkdown(join(dir, entry.name), label)));
    else if (entry.isFile() && MARKDOWN.test(entry.name)) found.push(label);
  }
  return found;
}

/** Copies a directory tree verbatim and returns how many files it contained. */
async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  let files = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) files += await copyTree(join(src, entry.name), join(dest, entry.name));
    else if (entry.isFile()) {
      await copyFile(join(src, entry.name), join(dest, entry.name));
      files++;
    }
  }
  return files;
}

/**
 * @param {string} [src] the shared docs directory
 * @param {string} [dest] the generated content directory, replaced wholesale
 * @returns {Promise<{ docs: number, assets: number }>}
 */
export async function copySharedDocs(src = SRC, dest = DEST) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  let docs = 0;
  let assets = 0;
  const skipped = [];
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === ASSETS_DIR) assets += await copyTree(join(src, entry.name), join(dest, entry.name));
      else skipped.push(...(await nestedMarkdown(join(src, entry.name), `docs/${entry.name}`)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md") || SKIP.has(entry.name)) continue;
    await copyFile(join(src, entry.name), join(dest, entry.name));
    docs++;
  }
  if (skipped.length > 0) {
    throw new Error(
      [
        `[copy-shared-docs] ${skipped.length} Markdown file(s) sit in a subdirectory of docs/ and would never be published:`,
        ...skipped.sort().map((file) => `  ${file}`),
        "  \u2192 docs/ publishes top-level Markdown only. Move the file up, or add nested",
        "    sections deliberately \u2014 the sidebar in apps/docs/astro.config.mjs is written by",
        "    hand, so a nested page would build and still be linked from nowhere.",
      ].join("\n"),
    );
  }
  return { docs, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The refusal above is a message for the author, not a defect in this script,
  // so it is printed as one — a stack trace over `prebuild` reads like the tool
  // broke rather than like the docs did.
  try {
    const { docs, assets } = await copySharedDocs();
    console.log(`[copy-shared-docs] copied ${docs} doc(s) and ${assets} asset(s) from ${SRC} to ${DEST}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
