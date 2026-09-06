import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copySharedDocs } from "./copy-shared-docs.mjs";

test("copies Markdown and nested shared-doc assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "copy-shared-docs-"));
  const src = join(root, "docs");
  const dest = join(root, "generated");

  try {
    await mkdir(join(src, "assets", "screenshots"), { recursive: true });
    await writeFile(join(src, "guide.md"), "![UI](./assets/screenshots/ui.svg)");
    await writeFile(join(src, "README.md"), "source-only instructions");
    await writeFile(join(src, "assets", "screenshots", "ui.svg"), "<svg></svg>");

    await copySharedDocs(src, dest);

    assert.equal(await readFile(join(dest, "guide.md"), "utf8"), "![UI](./assets/screenshots/ui.svg)");
    assert.equal(await readFile(join(dest, "assets", "screenshots", "ui.svg"), "utf8"), "<svg></svg>");
    await assert.rejects(readFile(join(dest, "README.md"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
