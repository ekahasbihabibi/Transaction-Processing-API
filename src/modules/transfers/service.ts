import { createHash, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../lib/app-error.js";

type TransferInput = {
  fromUserId: string;
  toUserId: string;
  amount: number;
  idempotencyKey: string;
};

export type TransactionRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: string;
  status: "pending" | "completed" | "failed";
  idempotency_key: string;
  request_fingerprint: string;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
};

type TransferResult = {
  transaction: TransactionRow;
  replayed: boolean;
};

const transactionColumns = `
  id, from_user_id, to_user_id, amount, status, idempotency_key,
  request_fingerprint, failure_code, failure_message, created_at,
  updated_at, completed_at, failed_at
`;

function fingerprint(input: TransferInput): string {
  return createHash("sha256")
    .update(`${input.fromUserId}|${input.toUserId}|${input.amount}`)
    .digest("hex");
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original error is more useful than a secondary rollback error.
  }
}

export async function processTransfer(
  pool: Pool,
  input: TransferInput,
  logger: FastifyBaseLogger
): Promise<TransferResult> {
  const client = await pool.connect();
  const requestFingerprint = fingerprint(input);

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    // Serialize requests that reuse the same key for the same sender.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${input.fromUserId}:${input.idempotencyKey}`
    ]);

    const existingResult = await client.query<TransactionRow>(
      `SELECT ${transactionColumns}
       FROM transactions
       WHERE from_user_id = $1 AND idempotency_key = $2`,
      [input.fromUserId, input.idempotencyKey]
    );
    const existing = existingResult.rows[0];
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used with a different request."
        );
      }
      await client.query("COMMIT");
      return { transaction: existing, replayed: true };
    }

    // A deterministic lock order prevents A->B and B->A transfers from deadlocking.
    const usersResult = await client.query<{ id: string; balance: string }>(
      `SELECT id, balance
       FROM users
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [[input.fromUserId, input.toUserId]]
    );
    if (usersResult.rows.length !== 2) {
      throw new AppError(404, "USER_NOT_FOUND", "Sender or receiver was not found.");
    }

    const sender = usersResult.rows.find((user) => user.id === input.fromUserId);
    if (!sender) {
      throw new AppError(404, "USER_NOT_FOUND", "Sender was not found.");
    }

    const transactionId = randomUUID();
    const pendingResult = await client.query<TransactionRow>(
      `INSERT INTO transactions (
         id, from_user_id, to_user_id, amount, status,
         idempotency_key, request_fingerprint
       )
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING ${transactionColumns}`,
      [
        transactionId,
        input.fromUserId,
        input.toUserId,
        input.amount.toString(),
        input.idempotencyKey,
        requestFingerprint
      ]
    );

    if (BigInt(sender.balance) < BigInt(input.amount)) {
      const failedResult = await client.query<TransactionRow>(
        `UPDATE transactions
         SET status = 'failed', failure_code = 'INSUFFICIENT_BALANCE',
             failure_message = 'User has insufficient balance.',
             failed_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING ${transactionColumns}`,
        [transactionId]
      );
      const failed = failedResult.rows[0];
      if (!failed) throw new Error("Failed transfer update returned no row.");
      await client.query("COMMIT");
      logger.info({ transactionId, fromUserId: input.fromUserId }, "transfer created");
      logger.warn(
        { transactionId, fromUserId: input.fromUserId, code: "INSUFFICIENT_BALANCE" },
        "transfer failed"
      );
      return { transaction: failed, replayed: false };
    }

    const debitResult = await client.query(
      `UPDATE users
       SET balance = balance - $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND balance >= $1`,
      [input.amount.toString(), input.fromUserId]
    );
    if (debitResult.rowCount !== 1) {
      throw new AppError(409, "CONCURRENT_BALANCE_CHANGE", "Balance changed; retry the transfer.");
    }

    await client.query(
      `UPDATE users
       SET balance = balance + $1, version = version + 1, updated_at = now()
       WHERE id = $2`,
      [input.amount.toString(), input.toUserId]
    );

    const completedResult = await client.query<TransactionRow>(
      `UPDATE transactions
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING ${transactionColumns}`,
      [transactionId]
    );
    const completed = completedResult.rows[0];
    if (!completed || !pendingResult.rows[0]) {
      throw new Error("Completed transfer update returned no row.");
    }

    await client.query("COMMIT");
    logger.info({ transactionId, fromUserId: input.fromUserId }, "transfer created");
    logger.info(
      { transactionId, fromUserId: input.fromUserId, toUserId: input.toUserId },
      "transfer completed"
    );
    return { transaction: completed, replayed: false };
  } catch (error) {
    await rollbackQuietly(client);
    if (!(error instanceof AppError)) {
      logger.error({ err: error, fromUserId: input.fromUserId }, "unexpected transfer error");
    }
    throw error;
  } finally {
    client.release();
  }
}
