import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong password", async () => {
    const hash = await hashPassword("Password123!");

    expect(hash).not.toContain("Password123!");
    await expect(verifyPassword("Password123!", hash)).resolves.toBe(true);
    await expect(verifyPassword("WrongPassword123!", hash)).resolves.toBe(false);
  });
});
