import { randomUUID } from "node:crypto";
import fastifyMultipart from "@fastify/multipart";
import type { DatabaseHandle } from "@mycollections/db";
import type { FastifyInstance, FastifyReply } from "fastify";
import { createJobLimiter, type JobLimiter, QueueFullError } from "../media/job-limiter.js";
import type { MediaStore, MediaVariant } from "../media/media-store.js";
import { ImageTooLargeError, processImage, UnsupportedImageError } from "../media/process-image.js";

export interface MediaRouteOptions {
  store: MediaStore;
  /** How many images are processed at once, and how many may wait. Defaults to one running, two waiting. */
  limiter?: JobLimiter;
  /** Largest upload accepted, in bytes. Defaults to 25 MiB. */
  maxUploadBytes?: number;
  /** Most live images one item may hold. Defaults to 50. */
  maxImagesPerItem?: number;
}

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_IMAGES_PER_ITEM = 50;

const uuid = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" } as const;

/**
 * Every id in a media path is a UUID, checked here before a handler runs —
 * before any query, and long before any path is built from one.
 */
const itemParams = {
  type: "object",
  required: ["id", "itemId"],
  properties: { id: uuid, itemId: uuid },
} as const;
const mediaParams = {
  type: "object",
  required: ["id", "itemId", "mediaId"],
  properties: { id: uuid, itemId: uuid, mediaId: uuid },
} as const;

/**
 * Where an upload came from rides in the query string, not the form: with the
 * streaming multipart API a field only counts if it precedes the file, so a
 * client could reorder its way past validation. `lookup` is not on the list —
 * only the server's own lookup pipeline (#40) may claim it.
 */
const uploadQuery = {
  type: "object",
  required: ["source"],
  additionalProperties: false,
  properties: { source: { type: "string", enum: ["user-attached", "user-camera"] } },
} as const;

const orderBody = {
  type: "object",
  required: ["ids"],
  additionalProperties: false,
  properties: { ids: { type: "array", items: uuid, maxItems: 500 } },
} as const;

type ItemParams = { id: string; itemId: string };
type MediaParams = ItemParams & { mediaId: string };

/**
 * Images attached to an item (#37), under the item they belong to.
 *
 * Every handler first checks that the collection is live, the item is live and
 * belongs to it, and — where a media id is named — that the image belongs to
 * that item. Only then does anything read the upload, touch the disk or write
 * a row, so a 404 never leaves a file or a row behind.
 */
export async function registerMediaRoutes(app: FastifyInstance, db: DatabaseHandle, options: MediaRouteOptions) {
  const { store } = options;
  const limiter = options.limiter ?? createJobLimiter({ concurrency: 1, maxWaiting: 2 });
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const maxImagesPerItem = options.maxImagesPerItem ?? DEFAULT_MAX_IMAGES_PER_ITEM;

  async function requireLiveItem({ id, itemId }: ItemParams): Promise<void> {
    const collection = await db.collections.getById(id);
    if (!collection) throw app.httpErrors.notFound("Collection not found");
    const item = await db.items.getById(itemId);
    if (!item || item.collectionId !== id) throw app.httpErrors.notFound("Item not found");
  }

  async function requireMedia(params: MediaParams) {
    await requireLiveItem(params);
    const media = await db.media.getForItem(params.itemId, params.mediaId);
    if (!media) throw app.httpErrors.notFound("Image not found");
    return media;
  }

  const base = "/api/collections/:id/items/:itemId/media";

  app.get(base, { schema: { params: itemParams } }, async (request) => {
    const params = request.params as ItemParams;
    await requireLiveItem(params);
    return db.media.listByItem(params.itemId);
  });

  // The upload lives in a scope of its own, so the multipart parser — and its
  // limits — exist for this one route and no other.
  await app.register(async (scope) => {
    await scope.register(fastifyMultipart, {
      throwFileSizeLimit: true,
      limits: {
        fileSize: maxUploadBytes,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 32,
        headerPairs: 16,
      },
    });
    const { RequestFileTooLargeError } = scope.multipartErrors;

    scope.post(base, { schema: { params: itemParams, querystring: uploadQuery } }, async (request, reply) => {
      const params = request.params as ItemParams;
      const { source } = request.query as { source: "user-attached" | "user-camera" };
      await requireLiveItem(params);
      if ((await db.media.countLive(params.itemId)) >= maxImagesPerItem) {
        throw app.httpErrors.conflict("This item already has as many images as it can hold");
      }

      // One file part and nothing else. The client's file name and declared type
      // are never read: neither is trusted, and the name is the user's data.
      let upload: Buffer | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type !== "file" || upload !== undefined) throw app.httpErrors.badRequest("Expected one image");
          upload = await part.toBuffer();
        }
      } catch (error) {
        if (error instanceof RequestFileTooLargeError) throw app.httpErrors.payloadTooLarge("Image too large");
        // Every other failure here — a second part, a field, a body that is not
        // multipart at all, a client that hung up — is the same mistake, answered
        // with fixed text rather than the parser's own message.
        throw app.httpErrors.badRequest("Expected one image");
      }
      if (upload === undefined) throw app.httpErrors.badRequest("Expected one image");

      let processed: Awaited<ReturnType<typeof processImage>>;
      try {
        const input = upload;
        processed = await limiter.run(() => processImage(input));
      } catch (error) {
        if (error instanceof UnsupportedImageError) throw app.httpErrors.unsupportedMediaType(error.message);
        if (error instanceof ImageTooLargeError) throw app.httpErrors.payloadTooLarge(error.message);
        // Sent rather than thrown: the app's error handler answers every 5xx as
        // a generic 500 and reports it as a crash, and this is neither — the
        // server is busy, and the client should simply try again.
        if (error instanceof QueueFullError) {
          return reply
            .code(503)
            .header("Retry-After", "5")
            .send({ statusCode: 503, error: "Service Unavailable", message: error.message });
        }
        throw error;
      }

      // Files first, then the row: a row never names files that are not there.
      // If the row cannot be written — the item was purged meanwhile — the
      // files go too.
      const mediaId = randomUUID();
      await store.write(params.itemId, mediaId, { display: processed.display, thumb: processed.thumb });
      try {
        const media = await db.media.create({
          id: mediaId,
          itemId: params.itemId,
          source,
          mimeType: processed.mimeType,
          bytes: processed.bytes,
          width: processed.width,
          height: processed.height,
        });
        return reply.code(201).send(media);
      } catch (error) {
        await store.remove(params.itemId, mediaId).catch(() => {});
        throw error;
      }
    });
  });

  async function serve(variant: MediaVariant, params: MediaParams, reply: FastifyReply) {
    await requireMedia(params);
    const stream = await store.read(params.itemId, params.mediaId, variant);
    // A row can outlive its files — a database restored from a backup taken
    // before they were swept. That is a missing image, not a server failure.
    if (!stream) throw app.httpErrors.notFound("Image not found");
    return (
      reply
        .type("image/webp")
        // Opened directly, the response can never act as a document: no
        // scripts, nothing else loaded, a sandboxed origin.
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        // Not kept in the browser's disk cache, so an image the user deleted
        // and purged does not linger on a shared machine. The web app holds the
        // bytes in memory for the session instead.
        .header("Cache-Control", "private, no-store")
        .send(stream)
    );
  }

  app.get(`${base}/:mediaId/display`, { schema: { params: mediaParams } }, async (request, reply) =>
    serve("display", request.params as MediaParams, reply),
  );
  app.get(`${base}/:mediaId/thumb`, { schema: { params: mediaParams } }, async (request, reply) =>
    serve("thumb", request.params as MediaParams, reply),
  );

  app.put(`${base}/order`, { schema: { params: itemParams, body: orderBody } }, async (request) => {
    const params = request.params as ItemParams;
    const { ids } = request.body as { ids: string[] };
    await requireLiveItem(params);
    // A list that is not exactly the item's live images was made from a stale
    // view (another tab added or removed one); refuse it whole.
    if (!(await db.media.reorder(params.itemId, ids))) {
      throw app.httpErrors.conflict("The images have changed; reload and try again");
    }
    return db.media.listByItem(params.itemId);
  });

  app.post(`${base}/:mediaId/make-primary`, { schema: { params: mediaParams } }, async (request) => {
    const params = request.params as MediaParams;
    await requireMedia(params);
    await db.media.moveToFront(params.itemId, params.mediaId);
    return db.media.listByItem(params.itemId);
  });

  // A soft delete, like every other delete in the app, so the web can offer Undo.
  // The files stay until the trash is emptied or the item is purged.
  app.delete(`${base}/:mediaId`, { schema: { params: mediaParams } }, async (request, reply) => {
    const params = request.params as MediaParams;
    await requireMedia(params);
    await db.media.softDelete(params.itemId, params.mediaId);
    return reply.code(204).send();
  });

  app.post(`${base}/:mediaId/restore`, { schema: { params: mediaParams } }, async (request) => {
    const params = request.params as MediaParams;
    await requireLiveItem(params);
    if (!(await db.media.restore(params.itemId, params.mediaId)))
      throw app.httpErrors.notFound("Image not found in trash");
    const media = await db.media.getForItem(params.itemId, params.mediaId);
    if (!media) throw app.httpErrors.notFound("Image not found");
    return media;
  });
}
