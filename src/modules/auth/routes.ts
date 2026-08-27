import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/app-error.js";
import { verifyPassword } from "../../lib/password.js";
import { parseInput } from "../../lib/validation.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128)
});

type LoginRow = {
  id: string;
  email: string;
  role: "user" | "admin";
  password_hash: string;
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request) => {
    const body = parseInput(loginSchema, request.body);
    const result = await app.db.query<LoginRow>(
      "SELECT id, email, role, password_hash FROM users WHERE email = $1",
      [body.email]
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return {
      success: true,
      data: {
        accessToken: token,
        tokenType: "Bearer"
      }
    };
  });
}
