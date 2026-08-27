import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({
  databaseUrl: config.DATABASE_URL,
  jwtSecret: config.JWT_SECRET,
  jwtExpiresIn: config.JWT_EXPIRES_IN,
  logLevel: config.LOG_LEVEL
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "graceful shutdown started");

  const forceClose = setTimeout(() => {
    app.log.error("graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceClose.unref();

  await app.close();
  clearTimeout(forceClose);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, "server failed to start");
  await app.close();
  process.exit(1);
}
