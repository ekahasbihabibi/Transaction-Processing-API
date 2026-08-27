import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/app-error.js";
import { serializeTransaction } from "../../lib/serializers.js";
import { parseInput } from "../../lib/validation.js";
import type { TransactionRow } from "../transfers/service.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().uuid().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional()
});

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/transactions",
    { preHandler: app.authenticate },
    async (request) => {
      const query = parseInput(querySchema, request.query);

      let userId = query.userId;
      if (request.user.role !== "admin") {
        if (userId && userId !== request.user.sub) {
          throw new AppError(403, "FORBIDDEN", "You may only view your own transactions.");
        }
        userId = request.user.sub;
      }

      const conditions: string[] = [];
      const parameters: unknown[] = [];
      if (userId) {
        parameters.push(userId);
        conditions.push(`(from_user_id = $${parameters.length} OR to_user_id = $${parameters.length})`);
      }
      if (query.status) {
        parameters.push(query.status);
        conditions.push(`status = $${parameters.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const countResult = await app.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM transactions ${where}`,
        parameters
      );

      parameters.push(query.pageSize);
      const limitParameter = `$${parameters.length}`;
      parameters.push((query.page - 1) * query.pageSize);
      const offsetParameter = `$${parameters.length}`;

      const transactionsResult = await app.db.query<TransactionRow>(
        `SELECT id, from_user_id, to_user_id, amount, status, idempotency_key,
                request_fingerprint, failure_code, failure_message, created_at,
                updated_at, completed_at, failed_at
         FROM transactions
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
        parameters
      );

      const total = countResult.rows[0]?.total ?? 0;
      return {
        success: true,
        data: transactionsResult.rows.map(serializeTransaction),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize)
        }
      };
    }
  );
}
