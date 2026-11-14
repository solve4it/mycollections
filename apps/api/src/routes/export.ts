import { type DatabaseHandle, exportBackup, type ImportMode, importBackup } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

/** The one message a refused import answers with, whatever refused it. */
export const INVALID_IMPORT_MESSAGE = "Invalid import file";

const importQuerySchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["skip"] },
  },
} as const;

export async function registerExportRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/export", async (_request, reply) => {
    // A JSON response cannot carry image files, and a row without its file is one
    // the import refuses — so the image rows stay out until the export becomes an
    // archive that carries both (#45).
    const document = { ...(await exportBackup(db)), media: [] };
    const filename = `mycollections-export-${new Date().toISOString().slice(0, 10)}.json`;
    return reply.header("Content-Disposition", `attachment; filename="${filename}"`).send(document);
  });

  app.post("/api/import", { schema: { querystring: importQuerySchema } }, async (request, reply) => {
    const { mode } = request.query as { mode?: ImportMode };
    try {
      const summary = importBackup(db, request.body, mode ?? "skip");
      return reply.code(200).send(summary);
    } catch {
      // Never the thrown message (#45): Zod quotes unknown key names, SQLite quotes
      // table and constraint names, and both come from a file someone else may have
      // written. Only a refusal with no detail leaves this route.
      throw app.httpErrors.badRequest(INVALID_IMPORT_MESSAGE);
    }
  });
}
