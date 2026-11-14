import { open, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import {
  type DatabaseHandle,
  exportBackup,
  type ImportMode,
  type ImportSummary,
  importDocument,
} from "@mycollections/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { importArchive } from "../archive/import-archive.js";
import {
  ArchiveError,
  type ArchiveLimits,
  DEFAULT_ARCHIVE_LIMITS,
  validateDocument,
} from "../archive/read-export-archive.js";
import type { JobLimiter } from "../media/job-limiter.js";
import type { MediaStore } from "../media/media-store.js";

/** The one message a refused import answers with, whatever refused it. */
export const INVALID_IMPORT_MESSAGE = "Invalid import file";
const TOO_LARGE_MESSAGE = "Import too large";
const BUSY_MESSAGE = "Another import is in progress";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/**
 * A JSON import body. The 1 MiB Fastify default refused a few thousand items (#45);
 * the document's item and collection counts are capped separately, as an
 * archive's are.
 */
const JSON_BODY_LIMIT = 32 * MiB;

/** How long an archive upload may go without sending a byte before it is dropped. */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * How far past the archive cap the body is still read (and discarded) so the client
 * gets a 413. Beyond it the connection is cut: an endless upload must not hold the
 * import lock for ever.
 */
const DRAIN_MARGIN_BYTES = 8 * MiB;

/** Every type a browser or tool labels a .zip with; the magic bytes are what is trusted. */
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed"];

export interface ImportLimits {
  /** The uploaded archive, counted as it streams to disk. Defaults to 2 GiB. */
  maxArchiveBytes?: number;
  /** What the archive may hold; see `DEFAULT_ARCHIVE_LIMITS`. */
  archive?: Partial<ArchiveLimits>;
  /** Milliseconds an archive upload may stay silent. Defaults to a minute. */
  idleTimeoutMs?: number;
}

export interface ExportRouteOptions {
  /** Without it there is nowhere to put an archive's images, and archive imports are refused. */
  media?: { store: MediaStore; limiter: JobLimiter; maxImagesPerItem: number };
  importLimits?: ImportLimits;
}

const importQuerySchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["skip"] },
  },
} as const;

/** The first four bytes of every zip that starts with a file entry. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function registerExportRoutes(app: FastifyInstance, db: DatabaseHandle, options: ExportRouteOptions = {}) {
  const maxArchiveBytes = options.importLimits?.maxArchiveBytes ?? 2 * GiB;
  const idleTimeoutMs = options.importLimits?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const archiveLimits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.importLimits?.archive };
  // One import at a time (#45), JSON and archive alike: an import's plan holds only
  // while nothing else adds the items it decided to bring images in with (review
  // of #449). Per app, which is per server.
  let importing = false;

  app.get("/api/export", async (_request, reply) => {
    // A JSON response cannot carry image files, and a row without its file is one
    // the import refuses — so the image rows stay out until the export becomes an
    // archive that carries both (#45).
    const document = { ...(await exportBackup(db)), media: [] };
    const filename = `mycollections-export-${new Date().toISOString().slice(0, 10)}.json`;
    return reply.header("Content-Disposition", `attachment; filename="${filename}"`).send(document);
  });

  await app.register(async (scope) => {
    // The archive arrives as the raw request stream; this route counts its bytes
    // itself, since Fastify's body limit does not apply to a parser that does not
    // read the body.
    scope.addContentTypeParser(ZIP_TYPES, (_request, payload, done) => done(null, payload));

    scope.post(
      "/api/import",
      { schema: { querystring: importQuerySchema }, bodyLimit: JSON_BODY_LIMIT },
      async (request, reply) => {
        const { mode } = request.query as { mode?: ImportMode };
        const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
        if (ZIP_TYPES.includes(type)) return importZip(request, reply);
        if (importing) throw app.httpErrors.conflict(BUSY_MESSAGE);
        try {
          // Counted before the schema runs, as an archive's document is.
          const document = validateDocument(request.body, archiveLimits);
          return reply.code(200).send(importDocument(db, document, mode ?? "skip"));
        } catch (error) {
          if (error instanceof ArchiveError && error.reason === "too-large") {
            throw app.httpErrors.payloadTooLarge(TOO_LARGE_MESSAGE);
          }
          // Never the thrown message (#45): Zod quotes unknown key names, SQLite quotes
          // table and constraint names, and both come from a file someone else may have
          // written. Only a refusal with no detail leaves this route.
          throw app.httpErrors.badRequest(INVALID_IMPORT_MESSAGE);
        }
      },
    );
  });

  async function importZip(request: FastifyRequest, reply: FastifyReply) {
    const media = options.media;
    if (!media) throw app.httpErrors.badRequest(INVALID_IMPORT_MESSAGE);
    if (importing) throw app.httpErrors.conflict(BUSY_MESSAGE);
    importing = true;

    let aborted = false;
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) aborted = true;
    });

    let path: string | undefined;
    let summary: ImportSummary;
    try {
      path = await media.store.importPath();
      await receive(request.body as Readable, path, maxArchiveBytes, idleTimeoutMs);
      if (!(await startsWithZipMagic(path))) throw new ArchiveError("invalid");
      summary = await importArchive({
        db,
        store: media.store,
        limiter: media.limiter,
        path,
        limits: archiveLimits,
        maxImagesPerItem: media.maxImagesPerItem,
        isAborted: () => aborted,
      });
    } catch (error) {
      if (error instanceof ArchiveError && error.reason === "too-large") {
        throw app.httpErrors.payloadTooLarge(TOO_LARGE_MESSAGE);
      }
      // A system error (a full disk, a permission) is the server's problem, not
      // the file's: it goes on as a generic 500. Everything else — the archive,
      // its document, an image the pipeline refused, the database refusing a row
      // — is a refusal of the file, with no detail.
      if (isSystemError(error)) throw error;
      throw app.httpErrors.badRequest(INVALID_IMPORT_MESSAGE);
    } finally {
      // Before replying, so nobody — the client, the next import — ever sees the
      // archive still on disk. The lock is released whatever happens here: a stuck
      // flag would refuse every import until a restart (review of #449).
      try {
        if (path !== undefined) await rm(path, { force: true });
      } finally {
        importing = false;
      }
    }
    return reply.code(200).send(summary);
  }
}

/**
 * Streams the upload to `path` (created exclusively, owner-only). Past `maxBytes`
 * it stops writing but reads on, discarding, so the client gets its 413 instead of
 * a dropped connection — up to a margin, beyond which the connection is cut. An
 * upload silent for `idleMs` is dropped too, so a stalled client cannot hold the
 * import lock (review of #449).
 */
async function receive(body: Readable, path: string, maxBytes: number, idleMs: number): Promise<void> {
  const file = await open(path, "wx", 0o600);
  let received = 0;
  let idle: NodeJS.Timeout | undefined;
  let timedOut = false;
  const armIdle = () => {
    clearTimeout(idle);
    // Destroyed without an error, which the loop below would otherwise see a
    // second time as an unhandled stream error; the flag says why it ended.
    idle = setTimeout(() => {
      timedOut = true;
      body.destroy();
    }, idleMs);
  };
  try {
    armIdle();
    for await (const chunk of body) {
      armIdle();
      received += (chunk as Buffer).length;
      if (received > maxBytes + DRAIN_MARGIN_BYTES) {
        body.destroy();
        break;
      }
      if (received > maxBytes) continue;
      await file.write(chunk as Buffer);
    }
  } catch (error) {
    if (!timedOut) throw error;
  } finally {
    clearTimeout(idle);
    await file.close();
  }
  if (timedOut) throw new ArchiveError("invalid");
  if (received > maxBytes) throw new ArchiveError("too-large");
}

async function startsWithZipMagic(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(ZIP_MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return bytesRead === head.length && head.equals(ZIP_MAGIC);
  } finally {
    await handle.close();
  }
}

function isSystemError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^E[A-Z]+$/.test(code);
}
