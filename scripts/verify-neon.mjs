// Post-migration verification against Neon dev (docs/architecture/m2-database-design.md §8).
// Run only after the product owner has approved the migration AND this run:
//   npm run verify:neon -- --approved
// Uses .env.local. Output is redacted (no connection strings, passwords or tokens)
// and saved to .verify-logs/verify-neon-<timestamp>.log (gitignored).
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";

if (!process.argv.includes("--approved")) {
  console.error(
    "Refusing to run: pass --approved once the product owner has authorised Neon verification.",
  );
  process.exit(1);
}

const redact = (text) =>
  text
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://<redacted>")
    .replace(/(password|passwd|pwd)\s*[=:]\s*[^\s&;'"`]+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");

mkdirSync(".verify-logs", { recursive: true });
const logPath = `.verify-logs/verify-neon-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const log = createWriteStream(logPath);

const child = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--project", "neon-verify"],
  {
    env: {
      ...process.env,
      TEAMHAPPI_NEON_VERIFY: "approved",
      FORCE_COLOR: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

for (const stream of [child.stdout, child.stderr]) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      const safe = redact(line);
      process.stdout.write(`${safe}\n`);
      log.write(`${safe}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) {
      const safe = redact(pending);
      process.stdout.write(`${safe}\n`);
      log.write(`${safe}\n`);
    }
  });
}

child.on("close", (code) => {
  const line = `verify:neon finished with exit code ${code}; log saved to ${logPath}`;
  console.log(line);
  log.end(`${line}\n`);
  process.exit(code ?? 1);
});
