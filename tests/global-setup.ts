import { execSync } from "node:child_process";

/** Applies migrations to the test database before any test file runs. */
export default function setup() {
  // prisma migrate needs an explicit user (node-postgres infers it, prisma doesn't)
  const url =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.USER}@localhost:5432/finance_dashboard_test`;
  if (!/finance_dashboard_test/.test(url)) {
    throw new Error(
      `Refusing to run tests against a non-test database: ${url.replace(/\/\/[^@]*@/, "//***@")}`,
    );
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
