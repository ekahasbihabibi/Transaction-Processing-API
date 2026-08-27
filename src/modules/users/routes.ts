import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/app-error.js";
import { hashPassword } from "../../lib/password.js";
import { serializeUser } from "../../lib/serializers.js";
import { parseInput } from "../../lib/validation.js";

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, "Password must contain an uppercase letter.")
    .regex(/[a-z]/, "Password must contain a lowercase letter.")
    .regex(/[0-9]/, "Password must contain a number.")
});

const userParamsSchema = z.object({ id: z.string().uuid() });

type UserRow = {
  id: string;
  name: string;
  email: string;
  balance: string;
  role: string;
  created_at: Date;
  updated_at: Date;
};

function assertCanAccessUser(request: FastifyRequest, requestedUserId: string): void {
  if (request.user.role !== "admin" && request.user.sub !== requestedUserId) {
    throw new AppError(403, "FORBIDDEN", "You may only access your own user data.");
  }
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post("/users", async (request, reply) => {
    const body = parseInput(createUserSchema, request.body);
    const id = randomUUID();
    const passwordHash = await hashPassword(body.password);

    try {
      const result = await app.db.query<UserRow>(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, balance, role, created_at, updated_at`,
        [id, body.name, body.email, passwordHash]
      );
      const user = result.rows[0];
      if (!user) throw new Error("Insert did not return a user.");

      return reply.status(201).send({ success: true, data: serializeUser(user) });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new AppError(409, "EMAIL_ALREADY_EXISTS", "A user with this email already exists.");
      }
      throw error;
    }
  });

  app.get(
    "/users/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const params = parseInput(userParamsSchema, request.params);
      assertCanAccessUser(request, params.id);

      const result = await app.db.query<UserRow>(
        `SELECT id, name, email, balance, role, created_at, updated_at
         FROM users WHERE id = $1`,
        [params.id]
      );
      const user = result.rows[0];
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");

      return { success: true, data: serializeUser(user) };
    }
  );

  app.get(
    "/users/:id/balance",
    { preHandler: app.authenticate },
    async (request) => {
      const params = parseInput(userParamsSchema, request.params);
      assertCanAccessUser(request, params.id);

      const result = await app.db.query<{ id: string; balance: string; updated_at: Date }>(
        "SELECT id, balance, updated_at FROM users WHERE id = $1",
        [params.id]
      );
      const user = result.rows[0];
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");

      return {
        success: true,
        data: {
          userId: user.id,
          balance: user.balance,
          updatedAt: user.updated_at.toISOString()
        }
      };
    }
  );
}
