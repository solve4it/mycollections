#!/usr/bin/env node
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../../docs");
const DEST = resolve(__dirname, "../src/content/docs/user");
const SKIP = new Set(["README.md"]);

async function copyDirectory(src, dest) {
  await mkdir(dest, { recursive: true });
  let copied = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      copied += await copyDirectory(join(src, entry.name), join(dest, entry.name));
    } else if (entry.isFile()) {
      await copyFile(join(src, entry.name), join(dest, entry.name));
      copied++;
    }
  }
  return copied;
}

export async function copySharedDocs(src = SRC, dest = DEST) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  let copied = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "assets") {
      copied += await copyDirectory(join(src, entry.name), join(dest, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".md") && !SKIP.has(entry.name)) {
      await copyFile(join(src, entry.name), join(dest, entry.name));
      copied++;
    }
  }
  return copied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const copied = await copySharedDocs();
  console.log(`[copy-shared-docs] copied ${copied} file(s) from ${SRC} to ${DEST}`);
}
