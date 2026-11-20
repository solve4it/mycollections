import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A removal elsewhere in the same item folder can rmdir it between writeNew's
// mkdir and its write (review of #452). This stands in for that removal: the
// first write finds its folder gone, exactly as it would in the race.
let raceOnce = false;
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      if (raceOnce) {
        raceOnce = false;
        const folder = join(String(args[0]), "..");
        await real.rmdir(folder);
      }
      return real.writeFile(...args);
    },
  };
});

const { MediaStore } = await import("./media-store.js");

const ITEM = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "media-race-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("MediaStore.writeNew against a concurrent removal", () => {
  it("makes the item folder again and writes, rather than failing the import", async () => {
    const store = await MediaStore.open(join(dir, "media"));
    raceOnce = true;
    await store.writeNew(ITEM, MEDIA, { display: Buffer.from("d"), thumb: Buffer.from("t") });
    expect(readdirSync(join(dir, "media", ITEM)).sort()).toEqual([`${MEDIA}.thumb.webp`, `${MEDIA}.webp`]);
  });
});
