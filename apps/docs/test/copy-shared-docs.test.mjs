import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySharedDocs } from "../scripts/copy-shared-docs.mjs";

let root;
let src;
let dest;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "copy-shared-docs-"));
  src = join(root, "docs");
  dest = join(root, "user");
  await mkdir(join(src, "assets", "screens"), { recursive: true });
  await writeFile(join(src, "items.md"), "![Shelf](./assets/screens/shelf.png)\n");
  await writeFile(join(src, "README.md"), "maintainer notes, not a page\n");
  await writeFile(join(src, "assets", "logo.png"), "png-bytes");
  await writeFile(join(src, "assets", "screens", "shelf.png"), "shelf-bytes");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("copySharedDocs", () => {
  it("copies the shared Markdown but not the maintainer README", async () => {
    await copySharedDocs(src, dest);

    expect(await readFile(join(dest, "items.md"), "utf8")).toBe("![Shelf](./assets/screens/shelf.png)\n");
    expect(await readdir(dest)).not.toContain("README.md");
  });

  it("copies docs/assets/ so relative image references resolve beside the copied Markdown", async () => {
    await copySharedDocs(src, dest);

    expect(await readFile(join(dest, "assets", "logo.png"), "utf8")).toBe("png-bytes");
    expect(await readFile(join(dest, "assets", "screens", "shelf.png"), "utf8")).toBe("shelf-bytes");
  });

  it("reports what it copied", async () => {
    expect(await copySharedDocs(src, dest)).toEqual({ docs: 1, assets: 2 });
  });

  it("leaves nothing from a previous run behind", async () => {
    await mkdir(join(dest, "assets"), { recursive: true });
    await writeFile(join(dest, "gone.md"), "deleted from docs/ last week\n");
    await writeFile(join(dest, "assets", "gone.png"), "stale");

    await copySharedDocs(src, dest);

    expect((await readdir(dest)).sort()).toEqual(["assets", "items.md"]);
    expect((await readdir(join(dest, "assets"))).sort()).toEqual(["logo.png", "screens"]);
  });
});
