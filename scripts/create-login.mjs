// Creates (or resets the password of) one verified sign-in account.
// Run it yourself, in a terminal, from the TeamHappi folder:
//   node scripts/create-login.mjs
// It asks for the email, name and password. The password is typed hidden, is
// hashed with Better Auth's own hasher and is never printed or stored in plain
// text. Uses DATABASE_MIGRATION_URL (owner role) from .env.local, and refuses
// any host other than localhost or the approved Neon dev endpoint.
//
// There is no public sign-up and no email provider yet, so this is how the
// first accounts are made (M3 plan, decision D-M3-5).

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "ep-ancient-shape-zan162ud.c-2.eu-west-2.aws.neon.tech",
];

const url =
  process.env.DATABASE_MIGRATION_URL ??
  (existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
        .match(/^DATABASE_MIGRATION_URL=(.*)$/m)?.[1]
        ?.trim()
    : undefined);
if (!url) {
  console.error(
    "DATABASE_MIGRATION_URL is missing. Run this from the TeamHappi folder (needs .env.local).",
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!ALLOWED_HOSTS.includes(host)) {
  console.error(`Refusing to write to ${host}.`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let hidden = false;
rl._writeToOutput = (text) => {
  if (!hidden || text.includes("\n") || text.includes("\r"))
    process.stdout.write(hidden ? "\n" : text);
};
const ask = (question, secret = false) =>
  new Promise((resolve) => {
    hidden = false;
    process.stdout.write(question);
    hidden = secret;
    rl.question("", (answer) => {
      hidden = false;
      resolve(answer.trim());
    });
  });

const email = (await ask("Email: ")).toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("That doesn't look like an email address.");
  process.exit(1);
}
const name = (await ask("Full name: ")) || email;
const password = await ask("Password (hidden, at least 12 characters): ", true);
const confirm = await ask("Type the password again: ", true);
rl.close();
if (password.length < 12 || password.length > 128) {
  console.error("Use between 12 and 128 characters.");
  process.exit(1);
}
if (password !== confirm) {
  console.error("The passwords don't match. Nothing was changed.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const hash = await hashPassword(password);
  await client.query("BEGIN");
  const existing = await client.query(
    `SELECT id FROM "user" WHERE email = $1`,
    [email],
  );
  let id;
  if (existing.rowCount) {
    id = existing.rows[0].id;
    await client.query(
      `UPDATE "user" SET email_verified = true, updated_at = now() WHERE id = $1`,
      [id],
    );
    const updated = await client.query(
      `UPDATE account SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential'`,
      [id, hash],
    );
    if (!updated.rowCount)
      await client.query(
        `INSERT INTO account (user_id, account_id, provider_id, password) VALUES ($1, $2, 'credential', $3)`,
        [id, String(id), hash],
      );
    // Sign out existing sessions after a password reset.
    await client.query(`DELETE FROM session WHERE user_id = $1`, [id]);
  } else {
    const created = await client.query(
      `INSERT INTO "user" (name, email, email_verified) VALUES ($1, $2, true) RETURNING id`,
      [name, email],
    );
    id = created.rows[0].id;
    await client.query(
      `INSERT INTO account (user_id, account_id, provider_id, password) VALUES ($1, $2, 'credential', $3)`,
      [id, String(id), hash],
    );
  }
  await client.query("COMMIT");
  console.log(
    `${existing.rowCount ? "Password reset" : "Account created"} for ${email} on ${host}. You can sign in now.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Nothing was changed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
