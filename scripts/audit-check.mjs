// Fails on any high/critical npm advisory that is not explicitly accepted below.
// Usage: node scripts/audit-check.mjs [--omit=dev]
// Each accepted advisory needs a reason and a review date; expired entries fail.

import { execFileSync } from "node:child_process";

// deepmerge-ts and mysql2 (via prisma / better-auth) are fixed by exact
// `overrides` in package.json; remove those once prisma ships patched versions.
const ACCEPTED = {
  // Dev-only lint tooling (eslint-config-next -> fast-glob); no fixed version exists.
  "GHSA-vfj7-8cjw-p6xm": {
    package: "braces",
    reason: "lint-time glob matching of our own patterns; no fixed version",
    reviewBy: "2027-01-31",
  },
};

const args = ["audit", "--json", ...process.argv.slice(2)];
let raw;
try {
  raw = execFileSync("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
} catch (error) {
  raw = error.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw);

const today = new Date().toISOString().slice(0, 10);
const problems = [];
const seen = new Set();

for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue; // transitive pointer; the root advisory is listed separately
    if (!["high", "critical"].includes(via.severity)) continue;
    const id = via.url?.split("/").pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const accepted = ACCEPTED[id];
    if (!accepted)
      problems.push(`${id} (${via.name}, ${via.severity}): ${via.title}`);
    else if (accepted.reviewBy < today)
      problems.push(`${id}: acceptance expired on ${accepted.reviewBy}`);
    else
      console.log(
        `accepted ${id} (${via.name}) until ${accepted.reviewBy}: ${accepted.reason}`,
      );
  }
}

if (problems.length) {
  console.error(
    `Unaccepted high/critical advisories:\n- ${problems.join("\n- ")}`,
  );
  process.exit(1);
}
console.log("npm audit: no unaccepted high/critical advisories");
