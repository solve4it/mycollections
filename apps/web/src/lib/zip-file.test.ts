import { describe, expect, it } from "vitest";
import { isZipFile } from "./zip-file.js";

describe("isZipFile (#45)", () => {
  it("knows a zip by its first bytes, whatever the browser called it", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(await isZipFile(new File([bytes], "backup.zip", { type: "application/x-zip-compressed" }))).toBe(true);
    expect(await isZipFile(new File([bytes], "renamed.json", { type: "application/json" }))).toBe(true);
  });

  it("says no to a JSON backup, an empty file and a near miss", async () => {
    expect(await isZipFile(new File(['{"version":1}'], "backup.json"))).toBe(false);
    expect(await isZipFile(new File([], "empty.zip"))).toBe(false);
    expect(await isZipFile(new File([new Uint8Array([0x50, 0x4b, 0x05, 0x06])], "x.zip"))).toBe(false);
  });
});
