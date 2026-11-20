import { open, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { ExportDocument } from "@mycollections/core";
import {
  type DatabaseHandle,
  exportBackup,
  exportCollection,
  IMPORT_MODES,
  type ImportMode,
  importDocument,
} from "@mycollections/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ImportAbortedError, prepareArchiveImport, runArchiveImport } from "../archive/import-archive.js";
import { type ImportJobState, ImportJobs } from "../archive/import-jobs.js";
import {
  ArchiveError,
  type ArchiveLimits,
  DEFAULT_ARCHIVE_LIMITS,
  validateDocument,
} from "../archive/read-export-archive.js";
import { attachmentDisposition, writeExportArchive } from "../archive/write-export-archive.js";
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
    mode: { type: "string", enum: [...IMPORT_MODES] },
  },
} as const;

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const collectionParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: UUID_PATTERN } },
} as const;

const jobParams = {
  type: "object",
  required: ["jobId"],
  properties: { jobId: { type: "string", pattern: UUID_PATTERN } },
} as const;

/** Seconds a client should wait before asking about a running import again (RFC 9110 §10.2.3). */
const POLL_SECONDS = "1";

/** The first four bytes of every zip that starts with a file entry. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function registerExportRoutes(app: FastifyInstance, db: DatabaseHandle, options: ExportRouteOptions = {}) {
  const maxArchiveBytes = options.importLimits?.maxArchiveBytes ?? 2 * GiB;
  const idleTimeoutMs = options.importLimits?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const archiveLimits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.importLimits?.archive };
  // One import at a time (#45), JSON and archive alike, held across an archive
  // job's 202 (#452). Per app, which is per server.
  const jobs = new ImportJobs();
  // A closing server stops a running job at its next check and waits for it to
  // remove what it wrote, so the database is never closed under its transaction.
  app.addHook("onClose", () => jobs.shutdown());

  async function sendArchive(request: FastifyRequest, reply: FastifyReply, document: ExportDocument, name: string) {
    const stream = await writeExportArchive(document, options.media?.store, (row) =>
      // Ids only: a row whose file is gone is worth knowing about, and nothing in
      // it is user data.
      request.log.warn({ itemId: row.itemId, mediaId: row.id }, "export left out an image whose file is missing"),
    );
    return reply
      .header("Content-Type", "application/zip")
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", attachmentDisposition(name))
      .send(stream);
  }

  // The whole database, images included, as an archive (#45).
  app.get("/api/export", async (request, reply) => sendArchive(request, reply, await exportBackup(db), "export"));

  // One live collection in the same format, from its own page (#45). A trashed one
  // answers 404, as the collection itself does.
  app.get<{ Params: { id: string } }>(
    "/api/collections/:id/export",
    { schema: { params: collectionParams } },
    async (request, reply) => {
      const document = await exportCollection(db, request.params.id);
      if (document === null) throw app.httpErrors.notFound("Collection not found");
      return sendArchive(request, reply, document, document.collections[0]?.name ?? "collection");
    },
  );

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
        if (ZIP_TYPES.includes(type)) return importZip(request, reply, mode ?? "skip");
        if (jobs.busy) throw app.httpErrors.conflict(BUSY_MESSAGE);
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

  function sendJob(reply: FastifyReply, job: ImportJobState) {
    reply.header("Cache-Control", "no-store");
    if (job.phase === "images" || job.phase === "saving") reply.header("Retry-After", POLL_SECONDS);
    return reply.send(job);
  }

  // Both GETs are polled about once a second while an import runs, so they stay
  // out of the info log, which would otherwise gain a line a second for minutes.

  // The running job, or the last to finish — how Settings finds an import again
  // after a reload (#452). `{ job: null }` rather than a 404 for "none yet", which
  // is an answer, not a missing resource.
  app.get("/api/import/current", { logLevel: "warn" }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send({ job: jobs.current() });
  });

  app.get<{ Params: { jobId: string } }>(
    "/api/import/:jobId",
    { schema: { params: jobParams }, logLevel: "warn" },
    async (request, reply) => {
      const job = jobs.get(request.params.jobId);
      // Unknown, superseded by a later import, or lost to a restart.
      if (job === null) throw app.httpErrors.notFound("Import not found");
      return sendJob(reply, job);
    },
  );

  /**
   * An archive import (#45, #452). Inside the request: receive the upload, check
   * it is a zip, read and validate it, and plan — so a bad file is refused with
   * the same fixed answers as ever. Then 202 with the job, whose images and
   * transaction run in the background; the client follows `Location`.
   */
  async function importZip(request: FastifyRequest, reply: FastifyReply, mode: ImportMode) {
    const media = options.media;
    if (!media) throw app.httpErrors.badRequest(INVALID_IMPORT_MESSAGE);
    if (!jobs.claim()) throw app.httpErrors.conflict(BUSY_MESSAGE);

    let path: string | undefined;
    // Once the job owns the archive and the lock, this request must not touch either.
    let handedOff = false;
    try {
      path = await media.store.importPath();
      await receive(request.body as Readable, path, maxArchiveBytes, idleTimeoutMs);
      if (!(await startsWithZipMagic(path))) throw new ArchiveError("invalid");
      const prepared = await prepareArchiveImport({
        db,
        path,
        limits: archiveLimits,
        maxImagesPerItem: media.maxImagesPerItem,
        mode,
      });
      const archivePath = path;
      const job = jobs.start(
        prepared.imagesTotal,
        (control) =>
          runArchiveImport({
            db,
            store: media.store,
            limiter: media.limiter,
            prepared,
            isAborted: () => control.aborted,
            onImage: (done) => control.imageDone(done),
            onSaving: () => control.saving(),
          }),
        {
          cleanup: () => rm(archivePath, { force: true }),
          classify: (error) => {
            // Same split as a refusal in the request: the server's own trouble is
            // logged (an errno error names a path under the media folder, never
            // user data) and reads "server"; anything about the file reads
            // "invalid", with nothing of its message kept.
            if (isSystemError(error)) {
              app.log.error({ err: error }, "background import failed");
              return "server";
            }
            return error instanceof ImportAbortedError ? "server" : "invalid";
          },
        },
      );
      handedOff = true;
      return reply
        .code(202)
        .header("Location", `/api/import/${job.id}`)
        .header("Retry-After", POLL_SECONDS)
        .header("Cache-Control", "no-store")
        .send(job);
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
      // A refusal: before replying, so nobody — the client, the next import — ever
      // sees the archive still on disk. The claim is released whatever happens
      // here: a stuck one would refuse every import until a restart (review of #449).
      if (!handedOff) {
        try {
          if (path !== undefined) await rm(path, { force: true });
        } finally {
          jobs.release();
        }
      }
    }
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
