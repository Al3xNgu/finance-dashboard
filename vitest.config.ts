import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // integration files share (and truncate) the test database
    fileParallelism: false,
    env: {
      // CI provides its own test-db URL; local default is homebrew postgres
      DATABASE_URL:
        process.env.DATABASE_URL ??
        `postgresql://${process.env.USER}@localhost:5432/finance_dashboard_test`,
      AUTH_SECRET: "vitest-secret-vitest-secret-vitest-secret",
      ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    },
  },
  resolve: {
    alias: {
      // `server-only` throws outside a React Server context; tests exercise
      // server modules directly, so stub it out.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
