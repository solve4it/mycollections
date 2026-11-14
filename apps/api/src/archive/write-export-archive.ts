import type { Readable } from "node:stream";
import type { ExportDocument, Media } from "@mycollections/core";
import { ZipFile } from "yazl";
import type { MediaStore } from "../media/media-store.js";
import { imageEntryName } from "./read-export-archive.js";

/**
 * Writes an export archive (#45): `export.json`, deflated, and each image's display
 * file stored as it is (WebP barely compresses), at the path its row implies.
 *
 * Every row is checked against the disk first and a row whose file is missing is
 * left out, so the archive never names a file it does not hold — the same rule the
 * import enforces. `onMissing` hears about each one, by id only.
 *
 * The images are streamed one at a time as the zip is read (`addReadStreamLazy`),
 * so a large collection neither sits in memory nor holds thousands of open files.
 */
export async function writeExportArchive(
  document: ExportDocument,
  store: MediaStore | undefined,
  onMissing: (row: Media) => void = () => {},
): Promise<Readable> {
  const present: Media[] = [];
  for (const row of document.media) {
    if (store && (await store.has(row.itemId, row.id, "display"))) present.push(row);
    else onMissing(row);
  }

  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({ ...document, media: present })), "export.json", { compress: true });
  for (const row of present) {
    zip.addReadStreamLazy(imageEntryName(row), { compress: false }, (callback) => {
      // A purge landing mid-download leaves no file; the stream fails and so does
      // the download, rather than an archive silently missing an image it lists.
      store?.read(row.itemId, row.id, "display").then(
        (stream) => (stream ? callback(null, stream) : callback(new Error("image file disappeared"), null as never)),
        (error: Error) => callback(error, null as never),
      );
    });
  }
  zip.end();
  return zip.outputStream as Readable;
}

/**
 * A `Content-Disposition` naming the download (RFC 6266): an ASCII `filename` every
 * client understands, and the real name in `filename*` (RFC 5987) for those that
 * read it. A collection name is the user's text, so control characters, quotes and
 * path separators are stripped from both — a raw CR/LF or quote would break the
 * header, and Node refuses some outright.
 */
export function attachmentDisposition(baseName: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const readable = [...baseName]
    .map((character) => (isUnsafeInFileName(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const ascii =
    readable
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  const encoded = encodeURIComponent(`mycollections-${readable || "export"}-${day}.zip`).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="mycollections-${ascii}-${day}.zip"; filename*=UTF-8''${encoded}`;
}

/** Control characters, and the characters a file name may not hold on some system. */
function isUnsafeInFileName(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || '/\\:*?"<>|'.includes(character);
}
