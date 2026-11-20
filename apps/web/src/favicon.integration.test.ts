import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app and the docs site carry the same tab icon (#332, #472). Two copies,
 * because each build serves only its own public/ folder; this keeps them one mark.
 */
describe("the favicon", () => {
  it("is the same file in the web app and on the docs site", () => {
    const web = readFileSync(resolve(__dirname, "../public/favicon.svg"), "utf8");
    const docs = readFileSync(resolve(__dirname, "../../docs/public/favicon.svg"), "utf8");
    expect(web).toBe(docs);
  });
});
