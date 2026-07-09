import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/lib/env";

const validBase = {
  DATABASE_URL: "postgresql://localhost:5432/finance_dashboard",
};

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = parseEnv(validBase);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PLAID_ENV).toBe("sandbox");
    expect(env.QUEUE_DRIVER).toBe("inprocess");
  });

  it("rejects a missing DATABASE_URL with a readable message", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(
      /postgres/,
    );
  });

  it("rejects an unknown PLAID_ENV", () => {
    expect(() =>
      parseEnv({ ...validBase, PLAID_ENV: "development" }),
    ).toThrow(/Invalid environment configuration/);
  });

  it("rejects an ENCRYPTION_KEY that is not 32 bytes of base64", () => {
    expect(() =>
      parseEnv({ ...validBase, ENCRYPTION_KEY: "too-short" }),
    ).toThrow(/32 bytes/);
  });

  it("accepts a well-formed 32-byte ENCRYPTION_KEY", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(parseEnv({ ...validBase, ENCRYPTION_KEY: key }).ENCRYPTION_KEY).toBe(
      key,
    );
  });
});
