import { type DatabaseHandle, exportBackup, type ImportMode, importBackup } from "@mycollections/db";
import type { FastifyInstance } from "fastify";

const importQuerySchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["skip"] },
  },
} as const;

export async function registerExportRoutes(app: FastifyInstance, db: DatabaseHandle) {
  app.get("/api/export", async (_request, reply) => {
    const document = await exportBackup(db);
    const filename = `mycollections-export-${new Date().toISOString().slice(0, 10)}.json`;
    return reply.header("Content-Disposition", `attachment; filename="${filename}"`).send(document);
  });

  app.post("/api/import", { schema: { querystring: importQuerySchema } }, async (request, reply) => {
    const { mode } = request.query as { mode?: ImportMode };
    try {
      const summary = importBackup(db, request.body, mode ?? "skip");
      return reply.code(200).send(summary);
    } catch (err) {
      throw app.httpErrors.badRequest(err instanceof Error ? err.message : "Invalid import file");
    }
  });
}
