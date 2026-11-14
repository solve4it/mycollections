import { type ExportDocument, ExportDocumentSchema, type Media } from "@mycollections/core";
import yauzl, { type Entry, type ZipFile } from "yauzl";

/**
 * Reads an export archive (#45): `export.json` plus `media/<itemId>/<mediaId>.webp`.
 *
 * The archive is untrusted input, so every number is bounded before anything is
 * inflated, and only the central directory is trusted for what the archive holds.
 * Entry paths are never used to decide where anything goes: an image is looked up
 * by the path its validated row implies, so a crafted name (`../`, an absolute
 * path, a symlink) can only fail to match. yauzl refuses `..` and absolute names
 * anyway (`strictFileNames`).
 *
 * Every refusal is an `ArchiveError` with fixed text: yauzl's own messages quote
 * entry names, which the archive's author chose.
 */

export interface ArchiveLimits {
  /** Entries in the central directory, directories and unknown files included. */
  maxEntries: number;
  /** Image rows in `export.json`. */
  maxMediaRows: number;
  /** `export.json`, declared and inflated. */
  maxJsonBytes: number;
  /** Each image, declared and inflated — the upload route's limit. */
  maxImageBytes: number;
  /** Everything the import reads, declared. */
  maxTotalBytes: number;
  /** Largest inflated/compressed ratio allowed for a deflated image. WebP barely compresses. */
  maxImageRatio: number;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = Object.freeze({
  maxEntries: 2_100,
  maxMediaRows: 2_000,
  maxJsonBytes: 64 * MiB,
  maxImageBytes: 25 * MiB,
  maxTotalBytes: 2 * GiB + 64 * MiB,
  maxImageRatio: 20,
});

export type ArchiveRefusal = "invalid" | "too-large" | "unsupported";

const MESSAGES: Record<ArchiveRefusal, string> = {
  invalid: "not a valid MyCollections export archive",
  "too-large": "the export archive is larger than an import allows",
  unsupported: "the export archive uses a feature an import does not support",
};

export class ArchiveError extends Error {
  constructor(readonly reason: ArchiveRefusal) {
    super(MESSAGES[reason]);
    this.name = "ArchiveError";
  }
}

export interface ExportArchive {
  /** Validated, and normalized to version 2. */
  document: ExportDocument;
  /** The display image for one of the document's rows, bounded as it inflates. */
  readImage(row: Media): Promise<Buffer>;
  close(): Promise<void>;
}

const STORED = 0;
const DEFLATE = 8;
const DOCUMENT_NAME = "export.json";

export function imageEntryName(row: Pick<Media, "itemId" | "id">): string {
  return `media/${row.itemId}/${row.id}.webp`;
}

export async function openExportArchive(path: string, limits: ArchiveLimits): Promise<ExportArchive> {
  const zipfile = await open(path);
  try {
    const entries = await readCentralDirectory(zipfile, limits);
    const documentEntry = entries.get(DOCUMENT_NAME);
    if (documentEntry === undefined) throw new ArchiveError("invalid");
    if (documentEntry.uncompressedSize > limits.maxJsonBytes) throw new ArchiveError("too-large");

    const document = parseDocument(await readEntry(zipfile, documentEntry, limits.maxJsonBytes));
    if (document.media.length > limits.maxMediaRows) throw new ArchiveError("too-large");

    let total = documentEntry.uncompressedSize;
    for (const row of document.media) {
      const entry = entries.get(imageEntryName(row));
      // Exactly one file per row: a row must never name a file that is not there.
      if (entry === undefined) throw new ArchiveError("invalid");
      if (entry.uncompressedSize > limits.maxImageBytes) throw new ArchiveError("too-large");
      if (entry.compressionMethod === DEFLATE && exceedsRatio(entry, limits.maxImageRatio)) {
        throw new ArchiveError("too-large");
      }
      total += entry.uncompressedSize;
    }
    if (total > limits.maxTotalBytes) throw new ArchiveError("too-large");

    return {
      document,
      readImage: async (row) => {
        const entry = entries.get(imageEntryName(row));
        if (entry === undefined) throw new ArchiveError("invalid");
        return readEntry(zipfile, entry, limits.maxImageBytes);
      },
      close: async () => zipfile.close(),
    };
  } catch (error) {
    zipfile.close();
    throw error;
  }
}

function exceedsRatio(entry: Entry, maxRatio: number): boolean {
  if (entry.uncompressedSize === 0) return false;
  return entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > maxRatio;
}

function parseDocument(bytes: Buffer): ExportDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ArchiveError("invalid");
  }
  const parsed = ExportDocumentSchema.safeParse(raw);
  if (!parsed.success) throw new ArchiveError("invalid");
  return parsed.data;
}

function open(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true, decodeStrings: true },
      (error, zipfile) => {
        if (error || !zipfile) reject(new ArchiveError("invalid"));
        else resolve(zipfile);
      },
    );
  });
}

/** Walks the central directory once, refusing what an import never accepts. */
function readCentralDirectory(zipfile: ZipFile, limits: ArchiveLimits): Promise<Map<string, Entry>> {
  if (zipfile.entryCount > limits.maxEntries) return Promise.reject(new ArchiveError("too-large"));
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    let failed = false;
    const fail = (error: ArchiveError) => {
      if (failed) return;
      failed = true;
      reject(error);
    };
    zipfile.on("entry", (entry: Entry) => {
      if (entry.isEncrypted()) return fail(new ArchiveError("unsupported"));
      if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATE) {
        return fail(new ArchiveError("unsupported"));
      }
      // A repeated name — a second export.json above all — would make "which one?"
      // the reader's guess.
      if (entries.has(entry.fileName)) return fail(new ArchiveError("invalid"));
      entries.set(entry.fileName, entry);
      if (entries.size > limits.maxEntries) return fail(new ArchiveError("too-large"));
      zipfile.readEntry();
    });
    zipfile.on("end", () => {
      if (!failed) resolve(entries);
    });
    // yauzl's messages quote entry names; none of that leaves here.
    zipfile.on("error", () => fail(new ArchiveError("invalid")));
    zipfile.readEntry();
  });
}

/**
 * Inflates one entry, counting bytes as they arrive: the declared size was
 * checked already, and yauzl's `validateEntrySizes` catches a lie at the end, but
 * the cap here stops reading the moment a stream passes it.
 */
function readEntry(zipfile: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(new ArchiveError("invalid"));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy();
          reject(new ArchiveError("too-large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", () => reject(new ArchiveError("invalid")));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}
