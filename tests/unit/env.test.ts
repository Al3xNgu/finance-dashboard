import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/lib/env";

const validBase = {
  DATABASE_URL: "postgresql://localhost:5432/finance_dashboard",
  AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
};

describe("parseEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = parseEnv(validBase);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PLAID_ENV).toBe("sandbox");
    expect(env.QUEUE_DRIVER).toBe("inprocess");
  });

  it("rejects a missing DATABASE_URL with a readable message", () => {
    expect(() =>
      parseEnv({ AUTH_SECRET: validBase.AUTH_SECRET }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a missing or short AUTH_SECRET", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: validBase.DATABASE_URL }),
    ).toThrow(/AUTH_SECRET/);
    expect(() =>
      parseEnv({ ...validBase, AUTH_SECRET: "short" }),
    ).toThrow(/AUTH_SECRET/);
  });

  it("requires a real sign-in provider in production", () => {
    expect(() =>
      parseEnv({ ...validBase, NODE_ENV: "production" }),
    ).toThrow(/sign-in provider/);
    // satisfied by SMTP pair
    expect(
      parseEnv({
        ...validBase,
        NODE_ENV: "production",
        EMAIL_SERVER: "smtp://mail:587",
        EMAIL_FROM: "noreply@example.com",
      }).NODE_ENV,
    ).toBe("production");
    // or by Google pair
    expect(
      parseEnv({
        ...validBase,
        NODE_ENV: "production",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }).NODE_ENV,
    ).toBe("production");
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
