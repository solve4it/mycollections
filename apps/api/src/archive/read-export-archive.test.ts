import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportDocument, Media } from "@mycollections/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { ArchiveError, type ArchiveLimits, DEFAULT_ARCHIVE_LIMITS, openExportArchive } from "./read-export-archive.js";

const COLLECTION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";

const image: Media = {
  id: MEDIA_ID,
  itemId: ITEM_ID,
  kind: "image",
  source: "user-attached",
  mimeType: "image/webp",
  bytes: 4,
  width: 1,
  height: 1,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function documentWith(media: Media[] = [image]): ExportDocument {
  return {
    version: 2,
    exportedAt: "2026-06-14T12:00:00.000Z",
    collections: [
      {
        id: COLLECTION_ID,
        name: "Records",
        fields: [{ id: "title", label: "Title", type: "text", required: true }],
        isFiniteSet: false,
        targetCount: null,
        itemView: "list",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    items: [
      {
        id: ITEM_ID,
        collectionId: COLLECTION_ID,
        status: "owned",
        fields: { title: "Kind of Blue" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    media,
  };
}

const IMAGE_BYTES = Buffer.from("RIFF");

type Entry = { name: string; data: Buffer; compress?: boolean };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archive-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function zip(entries: Entry[]): Promise<string> {
  const archive = new ZipFile();
  for (const entry of entries) archive.addBuffer(entry.data, entry.name, { compress: entry.compress ?? false });
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(chunk as Buffer);
  const path = join(dir, `a-${Math.random().toString(16).slice(2)}.zip`);
  writeFileSync(path, Buffer.concat(chunks));
  return path;
}

function standardEntries(document = documentWith()): Entry[] {
  return [
    { name: "export.json", data: Buffer.from(JSON.stringify(document)), compress: true },
    { name: `media/${ITEM_ID}/${MEDIA_ID}.webp`, data: IMAGE_BYTES },
  ];
}

/** Patches a 16-bit field in every local and central header (signatures 0x04034b50 / 0x02014b50). */
function patchHeaders(path: string, field: "flags" | "method", value: number): void {
  const bytes = readFileSync(path);
  for (let offset = 0; offset < bytes.length - 4; offset++) {
    const signature = bytes.readUInt32LE(offset);
    const at =
      signature === 0x04034b50
        ? offset + (field === "flags" ? 6 : 8)
        : signature === 0x02014b50
          ? offset + (field === "flags" ? 8 : 10)
          : -1;
    if (at === -1) continue;
    // Flags are OR-ed in, so the bits yazl set (UTF-8 names) survive; a method is replaced.
    bytes.writeUInt16LE(field === "flags" ? bytes.readUInt16LE(at) | value : value, at);
  }
  writeFileSync(path, bytes);
}

async function refusal(path: string, limits: Partial<ArchiveLimits> = {}): Promise<ArchiveError> {
  const error = await openExportArchive(path, { ...DEFAULT_ARCHIVE_LIMITS, ...limits }).then(
    async (archive) => {
      await archive.close();
      throw new Error("expected a refusal");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ArchiveError);
  return error as ArchiveError;
}

describe("openExportArchive (#45)", () => {
  it("reads the document and hands back each image's bytes by its row, not by any path in the archive", async () => {
    const archive = await openExportArchive(await zip(standardEntries()), DEFAULT_ARCHIVE_LIMITS);
    try {
      expect(archive.document).toEqual(documentWith());
      expect(await archive.readImage(image)).toEqual(IMAGE_BYTES);
    } finally {
      await archive.close();
    }
  });

  it("reads a version 1 document with no images", async () => {
    const { media: _media, ...rest } = documentWith([]);
    const archive = await openExportArchive(
      await zip([{ name: "export.json", data: Buffer.from(JSON.stringify({ ...rest, version: 1 })) }]),
      DEFAULT_ARCHIVE_LIMITS,
    );
    try {
      expect(archive.document.media).toEqual([]);
    } finally {
      await archive.close();
    }
  });

  it("ignores entries no row names, but counts them toward the entry limit", async () => {
    const extra = [...standardEntries(), { name: "notes.txt", data: Buffer.from("hello") }];
    const archive = await openExportArchive(await zip(extra), DEFAULT_ARCHIVE_LIMITS);
    await archive.close();
    expect((await refusal(await zip(extra), { maxEntries: 2 })).reason).toBe("too-large");
  });

  it("refuses an archive with no export.json", async () => {
    expect((await refusal(await zip([{ name: "other.json", data: Buffer.from("{}") }]))).reason).toBe("invalid");
  });

  it("refuses a document that is not valid JSON or not a valid export", async () => {
    expect((await refusal(await zip([{ name: "export.json", data: Buffer.from("{not json") }]))).reason).toBe(
      "invalid",
    );
    expect((await refusal(await zip([{ name: "export.json", data: Buffer.from('{"version":9}') }]))).reason).toBe(
      "invalid",
    );
  });

  it("refuses a row whose image file is missing, since a row must never name a file that is not there", async () => {
    expect((await refusal(await zip(standardEntries().slice(0, 1)))).reason).toBe("invalid");
  });

  it("refuses a second export.json, or any other repeated name", async () => {
    const twice = [...standardEntries(), { name: "export.json", data: Buffer.from("{}") }];
    expect((await refusal(await zip(twice))).reason).toBe("invalid");
  });

  it("refuses more image rows than the limit", async () => {
    expect((await refusal(await zip(standardEntries()), { maxMediaRows: 0 })).reason).toBe("too-large");
  });

  it("refuses an export.json larger than its limit", async () => {
    expect((await refusal(await zip(standardEntries()), { maxJsonBytes: 10 })).reason).toBe("too-large");
  });

  it("refuses an image declared larger than one image may be", async () => {
    expect((await refusal(await zip(standardEntries()), { maxImageBytes: 2 })).reason).toBe("too-large");
  });

  it("refuses an archive whose declared contents exceed the total", async () => {
    expect((await refusal(await zip(standardEntries()), { maxTotalBytes: 10 })).reason).toBe("too-large");
  });

  it("refuses an image that inflates far beyond its compressed size — the shape of a zip bomb", async () => {
    const entries = standardEntries();
    const bomb = [
      entries[0] as Entry,
      { name: `media/${ITEM_ID}/${MEDIA_ID}.webp`, data: Buffer.alloc(1_000_000), compress: true },
    ];
    expect((await refusal(await zip(bomb))).reason).toBe("too-large");
  });

  it("refuses an encrypted entry", async () => {
    // Deflated: yauzl refuses an encrypted *stored* entry by itself (a size mismatch,
    // which reads as invalid), so only a deflated one reaches this check.
    const path = await zip(standardEntries().map((entry) => ({ ...entry, compress: true })));
    patchHeaders(path, "flags", 0x0001);
    expect((await refusal(path)).reason).toBe("unsupported");
  });

  it("refuses a compression method other than stored or deflate", async () => {
    const path = await zip(standardEntries().map((entry) => ({ ...entry, compress: false })));
    patchHeaders(path, "method", 12);
    expect((await refusal(path)).reason).toBe("unsupported");
  });

  it("refuses a file that is not a zip at all", async () => {
    const path = join(dir, "not.zip");
    writeFileSync(path, "plain text, not an archive");
    expect((await refusal(path)).reason).toBe("invalid");
  });

  it("never puts an entry name in its error message, since the archive's author chose it", async () => {
    // yazl will not write a ".." path, so write a stand-in and patch the bytes.
    const path = await zip([{ name: "do-not-report/qq/qq/x", data: Buffer.from("x") }]);
    writeFileSync(path, Buffer.from(readFileSync(path).toString("latin1").replaceAll("/qq/", "/../"), "latin1"));
    const error = await refusal(path);
    expect(error.message).not.toContain("do-not-report");
  });
});
