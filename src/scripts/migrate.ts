import { loadConfig } from "../config.js";
import { runMigrations } from "../db/migrations.js";

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
console.log("Database migrations completed.");
