import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // Real PostgreSQL 18 (embedded locally, service container in CI).
        extends: true,
        test: {
          name: "db",
          include: [
            "tests/integration/**/*.test.ts",
            "tests/security/**/*.test.ts",
          ],
          globalSetup: ["tests/setup/db-global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
