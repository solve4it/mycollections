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
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === ASSETS_DIR) assets += await copyTree(join(src, entry.name), join(dest, entry.name));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md") || SKIP.has(entry.name)) continue;
    await copyFile(join(src, entry.name), join(dest, entry.name));
    docs++;
  }
  return { docs, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { docs, assets } = await copySharedDocs();
  console.log(`[copy-shared-docs] copied ${docs} doc(s) and ${assets} asset(s) from ${SRC} to ${DEST}`);
}
