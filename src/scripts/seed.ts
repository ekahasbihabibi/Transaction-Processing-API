import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { hashPassword } from "../lib/password.js";

const config = loadConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL });

const users = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice Sender",
    email: "alice@example.com",
    balance: "100000",
    role: "user"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Bob Receiver",
    email: "bob@example.com",
    balance: "25000",
    role: "user"
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Assessment Admin",
    email: "admin@example.com",
    balance: "0",
    role: "admin"
  }
] as const;

try {
  const passwordHash = await hashPassword("Password123!");
  for (const user of users) {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, balance, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      [user.id, user.name, user.email, passwordHash, user.balance, user.role]
    );
  }
  console.log("Seed data is ready.");
} finally {
  await pool.end();
}
