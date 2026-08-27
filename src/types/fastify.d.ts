import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

type AuthenticatedUser = {
  sub: string;
  email: string;
  role: "user" | "admin";
};

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthenticatedUser;
    user: AuthenticatedUser;
  }
}
