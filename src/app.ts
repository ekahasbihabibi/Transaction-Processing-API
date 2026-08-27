import fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { Pool } from "pg";
import { AppError } from "./lib/app-error.js";
import { authRoutes } from "./modules/auth/routes.js";
import { transactionRoutes } from "./modules/transactions/routes.js";
import { transferRoutes } from "./modules/transfers/routes.js";
import { userRoutes } from "./modules/users/routes.js";

type BuildAppOptions = {
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn?: string;
  logger?: boolean;
  logLevel?: string;
};

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logger = options.logger === false
    ? false
    : {
        level: options.logLevel ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "request.headers.authorization",
            "password",
            "token",
            "accessToken"
          ],
          censor: "[REDACTED]"
        }
      };

  const app = fastify({ logger });
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 20,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });

  app.decorate("db", pool);
  await app.register(fastifyJwt, {
    secret: options.jwtSecret,
    sign: { expiresIn: options.jwtExpiresIn ?? "1h" }
  });

  app.decorate("authenticate", async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, "UNAUTHORIZED", "A valid bearer token is required.");
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      return reply.status(400).send({
        success: false,
        error: { code: "INVALID_JSON", message: "The request body is not valid JSON." }
      });
    }

    const databaseCode = postgresErrorCode(error);
    if (["23503", "23505", "23514"].includes(databaseCode ?? "")) {
      request.log.warn({ err: error, databaseCode }, "database constraint rejected request");
      return reply.status(409).send({
        success: false,
        error: {
          code: "DATABASE_CONSTRAINT_ERROR",
          message: "The request conflicts with stored data."
        }
      });
    }

    request.log.error({ err: error }, "unexpected application error");
    return reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: "ROUTE_NOT_FOUND", message: "The requested route does not exist." }
    });
  });

  app.get("/health", async (_request, reply) => {
    try {
      await app.db.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(transferRoutes);
  await app.register(transactionRoutes);

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
