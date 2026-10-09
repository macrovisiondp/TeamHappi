import { fileURLToPath } from "node:url";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";

const projects: TestProjectInlineConfiguration[] = [
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
];

// Post-migration verification against Neon dev. Exists only when explicitly
// approved for a run (npm run verify:neon); never part of `npm test` or CI.
if (process.env.TEAMHAPPI_NEON_VERIFY === "approved") {
  projects.push({
    extends: true,
    test: {
      name: "neon-verify",
      include: [
        "tests/security/db-roles.test.ts",
        "tests/security/context-boundary.test.ts",
        "tests/security/tenant-context.test.ts",
        "tests/security/tenant-isolation.test.ts",
        "tests/security/user-visibility.test.ts",
        "tests/neon-verify/**/*.test.ts",
      ],
      globalSetup: ["tests/setup/neon-verify-setup.ts"],
      setupFiles: ["tests/setup/neon-verify-worker.ts"],
      fileParallelism: false,
      // Measured from the verification machine: ~360 ms per round trip and
      // 3.7–5.6 s per new connection. The 200-transaction test sets its own
      // 45-minute budget.
      testTimeout: 10 * 60_000,
      hookTimeout: 15 * 60_000,
    },
  });
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { environment: "node", projects },
});
