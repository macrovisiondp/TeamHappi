// Post-migration verification against Neon dev (docs/architecture/m2-database-design.md §8).
// Run only after the product owner has approved the migration AND this run:
//   npm run verify:neon -- --approved
// Uses .env.local; never prints connection strings.
import { spawnSync } from "node:child_process";

if (!process.argv.includes("--approved")) {
  console.error(
    "Refusing to run: pass --approved once the product owner has authorised Neon verification.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--project", "neon-verify"],
  {
    stdio: "inherit",
    env: { ...process.env, TEAMHAPPI_NEON_VERIFY: "approved" },
  },
);
process.exit(result.status ?? 1);
