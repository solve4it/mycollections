import { describe, expect, it } from "vitest";
import { findWarnings } from "../scripts/build.mjs";

describe("findWarnings", () => {
  it("finds nothing in a clean build log", () => {
    const log = [
      "10:50:05 [content] Syncing content",
      "10:50:08 [build] 8 page(s) built in 2.41s",
      "10:50:08 [build] Complete!",
    ].join("\n");

    expect(findWarnings(log)).toEqual([]);
  });

  it("returns the warning line, not just a count", () => {
    const log = '10:50:08 [WARN] [content] The collection "i18n" does not exist or is empty.';

    expect(findWarnings(log)).toEqual([log]);
  });

  it("finds a warning that another line was written across", () => {
    // Astro writes its build tree and its warnings to the same stream, and they
    // interleave: this is the real shape the 404 warning arrived in.
    const log = "  ├─ /404.html10:50:08 [WARN] [content] Entry docs → 404 was not found.";

    expect(findWarnings(log)).toEqual([log]);
  });

  it("sees through the color codes a TTY build writes", () => {
    // Written as escapes rather than literal control characters so the line
    // survives being read, copied and diffed.
    const esc = "\u001b";
    const log = `${esc}[2m10:50:08${esc}[22m ${esc}[33m[WARN]${esc}[39m ${esc}[2m[content]${esc}[22m empty collection`;

    expect(findWarnings(log)).toEqual([log]);
  });

  it("returns every warning, so one build reports them all", () => {
    const log = ["10:50:08 [WARN] first", "10:50:08 [build] fine", "10:50:09 [WARN] second"].join("\n");

    expect(findWarnings(log)).toEqual(["10:50:08 [WARN] first", "10:50:09 [WARN] second"]);
  });

  it("does not fire on the word WARN outside the level tag", () => {
    const log = ["10:50:08 [build] /user/troubleshooting/WARNING.md -> 1 page", "WARN me later"].join("\n");

    expect(findWarnings(log)).toEqual([]);
  });
});
