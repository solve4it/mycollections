/**
 * End-to-end guard for the image rule in `docs/README.md` (#295).
 *
 * "Put images in `docs/assets/` and reference them with relative paths" is a
 * promise about the built site, not about the copy step, and the two are not the
 * same thing: Astro resolves a Markdown image reference inside a content
 * collection through its image pipeline, so `./assets/x.png` only works if the
 * file sits next to the copied Markdown *and* the pipeline can emit it. A test
 * that only counted copied files would still pass with the site shipping a
 * broken image — or, as before the fix, with the build failing outright.
 *
 * So this builds the real site: the real `docs/` plus one fixture page and its
 * image, through the real `copySharedDocs`, the real Astro config and the real
 * image pipeline, into a throwaway output directory. The fixture lives here
 * rather than in `docs/` so the published user guide carries no test page.
 *
 * Two things about the shape of this test are forced rather than chosen.
 * Starlight's `docsLoader()` reads from `src/content/docs` and nowhere else, so
 * the fixture build has to go through that directory — it cannot be pointed at
 * an isolated content root. And the build runs as a subprocess rather than
 * through Astro's API so that no Vite or Astro module state is shared with the
 * test runner. The first of those means no other test file may touch
 * `src/content/docs/user`: vitest runs test files in parallel, and a second one
 * that did would race this build.
 */
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";
import { copySharedDocs } from "../scripts/copy-shared-docs.mjs";
import { BASE } from "../site.mjs";

const run = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const SHARED_DOCS = resolve(PACKAGE_ROOT, "../../docs");
const CONTENT_DEST = resolve(PACKAGE_ROOT, "src/content/docs/user");
const FIXTURE_DOCS = join(__dirname, "fixtures", "docs");
const ASTRO = resolve(PACKAGE_ROOT, "node_modules/.bin/astro");

// The content directory is generated and gitignored, but this test overwrites it
// with the fixture build's copy, so put the real one back for whatever runs next.
afterAll(async () => {
  await copySharedDocs();
});

it("publishes a docs/assets image with a src that resolves to a file the build emitted", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "docs-images-"));
  const docs = join(workspace, "docs");
  const outDir = join(workspace, "dist");

  try {
    // The fixture page is merged into a copy of the real docs so the build sees
    // everything Starlight's sidebar refers to, and so the image travels the
    // same route any real screenshot would.
    await cp(SHARED_DOCS, docs, { recursive: true });
    await cp(FIXTURE_DOCS, docs, { recursive: true, force: true });

    await copySharedDocs(docs, CONTENT_DEST);
    await run(ASTRO, ["build", "--outDir", outDir], { cwd: PACKAGE_ROOT });

    const html = await readFile(join(outDir, "user", "image-pipeline-check", "index.html"), "utf8");
    const img = html.match(/<img\b[^>]*alt="Shared docs image fixture"[^>]*>/)?.[0];
    expect(img, `no <img> for the fixture image in:\n${html.slice(0, 2000)}`).toBeTruthy();

    const src = img.match(/\bsrc="([^"]*)"/)?.[1];
    // An unprocessed reference would ship as `./assets/…`, which the browser
    // resolves against the page URL and gets a 404 for. Astro rewrites it to a
    // real, base-prefixed URL of its own.
    expect(src).toMatch(new RegExp(`^${BASE}/`));
    expect(src).not.toContain("./assets/");

    const emitted = join(outDir, src.slice(BASE.length));
    const file = await stat(emitted).catch(() => null);
    expect(file, `${src} does not resolve to a built file (${emitted})`).not.toBeNull();
    expect(file.size).toBeGreaterThan(0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}, 180_000);
