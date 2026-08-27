import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/app-error.js";
import { serializeTransaction } from "../../lib/serializers.js";
import { parseInput } from "../../lib/validation.js";
import { processTransfer } from "./service.js";

const transferSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.number().int().positive().safe()
});

const idempotencyHeaderSchema = z.string().trim().min(8).max(255);

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/transfers",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = parseInput(transferSchema, request.body);
      const idempotencyKey = parseInput(
        idempotencyHeaderSchema,
        request.headers["idempotency-key"]
      );

      if (body.fromUserId === body.toUserId) {
        throw new AppError(400, "SAME_USER_TRANSFER", "Sender and receiver must be different users.");
      }
      if (request.user.role !== "admin" && request.user.sub !== body.fromUserId) {
        throw new AppError(403, "FORBIDDEN", "You may only transfer from your own account.");
      }

      const result = await processTransfer(
        app.db,
        { ...body, idempotencyKey },
        request.log
      );

      if (result.transaction.status === "failed") {
        throw new AppError(
          422,
          result.transaction.failure_code ?? "TRANSFER_FAILED",
          result.transaction.failure_message ?? "The transfer failed.",
          {
            transactionId: result.transaction.id,
            idempotentReplayed: result.replayed
          }
        );
      }

      return reply.status(result.replayed ? 200 : 201).send({
        success: true,
        data: serializeTransaction(result.transaction),
        meta: { idempotentReplayed: result.replayed }
      });
    }
  );
}
