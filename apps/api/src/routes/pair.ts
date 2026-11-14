import type { FastifyInstance } from "fastify";
import { PAIRING_CODE_PATTERN, type PairingCodes } from "../pairing.js";

export interface PairingOptions {
  codes: PairingCodes;
  /** Called after a successful pairing, so the server can mint and announce the next link. */
  onPaired: () => void;
}

/**
 * `POST /api/pair` (#241): trades the live one-time code for the device token.
 *
 * Registered outside the authenticated scope — a browser pairing has no token yet — and
 * only when `buildApp` is given `pairing`, which `server.ts` does in development on a
 * loopback bind alone. Everywhere else the route does not exist and answers 404.
 *
 * Every failure is the same `401 {"error":"Unauthorized"}` the bearer guard sends, so a
 * response says nothing about whether a code was wrong, used or expired.
 */
export async function registerPairRoute(app: FastifyInstance, token: string, pairing: PairingOptions) {
  app.post<{ Body: { code: string } }>(
    "/api/pair",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", pattern: PAIRING_CODE_PATTERN } },
        },
      },
      // A JSON body only. Fastify parses text/plain by default, and text/plain is what a
      // page on another origin can POST without a preflight. Its string body fails the
      // object schema anyway; refusing the type outright says so before parsing.
      preValidation: async (request, reply) => {
        if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
          return reply.code(400).send({ error: "Bad Request" });
        }
      },
    },
    async (request, reply) => {
      if (!pairing.codes.redeem(request.body.code)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      pairing.onPaired();
      return reply.header("cache-control", "no-store").send({ token });
    },
  );
}
