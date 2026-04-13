#!/usr/bin/env node
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../../docs");
const DEST = resolve(__dirname, "../src/content/docs/user");
const SKIP = new Set(["README.md"]);

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const entries = await readdir(SRC, { withFileTypes: true });
let copied = 0;
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".md") || SKIP.has(entry.name)) continue;
  await copyFile(join(SRC, entry.name), join(DEST, entry.name));
  copied++;
}
console.log(`[copy-shared-docs] copied ${copied} file(s) from ${SRC} to ${DEST}`);
