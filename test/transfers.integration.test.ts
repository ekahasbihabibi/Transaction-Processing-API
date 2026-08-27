import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { runMigrations } from "../src/db/migrations.js";
import { hashPassword } from "../src/lib/password.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://app:app@localhost:5432/transaction_api_test";
const jwtSecret = "integration-test-secret-that-is-at-least-32-characters";

let app: FastifyInstance;

type TestUser = {
  id: string;
  email: string;
  token: string;
};

async function createUser(name: string, balance: number): Promise<TestUser> {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id}@example.com`;
  const passwordHash = await hashPassword("Password123!");
  await app.db.query(
    `INSERT INTO users (id, name, email, password_hash, balance)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, name, email, passwordHash, balance.toString()]
  );

  return {
    id,
    email,
    token: app.jwt.sign({ sub: id, email, role: "user" })
  };
}

function transferRequest(
  sender: TestUser,
  receiver: TestUser,
  amount: number,
  idempotencyKey: string
) {
  return app.inject({
    method: "POST",
    url: "/transfers",
    headers: {
      authorization: `Bearer ${sender.token}`,
      "idempotency-key": idempotencyKey
    },
    payload: {
      fromUserId: sender.id,
      toUserId: receiver.id,
      amount
    }
  });
}

beforeAll(async () => {
  await runMigrations(databaseUrl);
  app = await buildApp({ databaseUrl, jwtSecret, logger: false });
  await app.ready();
});

beforeEach(async () => {
  await app.db.query("TRUNCATE TABLE transactions, users CASCADE");
});

afterAll(async () => {
  await app.close();
});

describe("POST /transfers", () => {
  it("completes a valid transfer atomically", async () => {
    const sender = await createUser("Alice", 100_000);
    const receiver = await createUser("Bob", 25_000);

    const response = await transferRequest(sender, receiver, 10_000, "success-key-0001");

    expect(response.statusCode).toBe(201);
    expect(response.json().data.status).toBe("completed");
    const balances = await app.db.query<{ id: string; balance: string }>(
      "SELECT id, balance FROM users ORDER BY id"
    );
    expect(balances.rows.find((row) => row.id === sender.id)?.balance).toBe("90000");
    expect(balances.rows.find((row) => row.id === receiver.id)?.balance).toBe("35000");
  });

  it("records a failed transfer and leaves balances unchanged when funds are insufficient", async () => {
    const sender = await createUser("Alice", 5_000);
    const receiver = await createUser("Bob", 25_000);

    const response = await transferRequest(sender, receiver, 10_000, "insufficient-key-0001");

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INSUFFICIENT_BALANCE");
    const transaction = await app.db.query<{ status: string }>(
      "SELECT status FROM transactions"
    );
    expect(transaction.rows).toEqual([{ status: "failed" }]);
    const senderBalance = await app.db.query<{ balance: string }>(
      "SELECT balance FROM users WHERE id = $1",
      [sender.id]
    );
    expect(senderBalance.rows[0]?.balance).toBe("5000");
  });

  it("rejects a zero amount", async () => {
    const sender = await createUser("Alice", 100_000);
    const receiver = await createUser("Bob", 0);

    const response = await transferRequest(sender, receiver, 0, "invalid-key-000001");

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("replays the original result without deducting twice", async () => {
    const sender = await createUser("Alice", 100_000);
    const receiver = await createUser("Bob", 0);
    const key = "duplicate-key-000001";

    const first = await transferRequest(sender, receiver, 10_000, key);
    const second = await transferRequest(sender, receiver, 10_000, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().meta.idempotentReplayed).toBe(true);
    expect(second.json().data.id).toBe(first.json().data.id);
    const transactionCount = await app.db.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM transactions"
    );
    expect(transactionCount.rows[0]?.total).toBe(1);
    const senderBalance = await app.db.query<{ balance: string }>(
      "SELECT balance FROM users WHERE id = $1",
      [sender.id]
    );
    expect(senderBalance.rows[0]?.balance).toBe("90000");
  });

  it("prevents overspending during concurrent transfers", async () => {
    const sender = await createUser("Alice", 100_000);
    const receiverA = await createUser("Bob", 0);
    const receiverB = await createUser("Charlie", 0);

    const [responseA, responseB] = await Promise.all([
      transferRequest(sender, receiverA, 80_000, "concurrent-key-0001"),
      transferRequest(sender, receiverB, 80_000, "concurrent-key-0002")
    ]);

    expect([responseA.statusCode, responseB.statusCode].sort()).toEqual([201, 422]);
    const senderBalance = await app.db.query<{ balance: string }>(
      "SELECT balance FROM users WHERE id = $1",
      [sender.id]
    );
    expect(senderBalance.rows[0]?.balance).toBe("20000");
    const statusCounts = await app.db.query<{ status: string; total: number }>(
      "SELECT status, count(*)::int AS total FROM transactions GROUP BY status ORDER BY status"
    );
    expect(statusCounts.rows).toEqual([
      { status: "completed", total: 1 },
      { status: "failed", total: 1 }
    ]);
  });

  it("rejects a request without authentication", async () => {
    const sender = await createUser("Alice", 100_000);
    const receiver = await createUser("Bob", 0);

    const response = await app.inject({
      method: "POST",
      url: "/transfers",
      headers: { "idempotency-key": "unauthorized-key-0001" },
      payload: { fromUserId: sender.id, toUserId: receiver.id, amount: 10_000 }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });
});
