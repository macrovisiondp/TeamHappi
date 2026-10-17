// Platform Admin with real staff access and MFA (M5.1), against the LOCAL
// synthetic stack (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - synthetic platform staff (seeded), must enrol MFA
//   Cara - tenant worker; Ada adds her as staff during the test
//   Dan  - no organisation, not staff
// Each run resets the synthetic MFA state through the LOCAL database (refuses
// any other host). Skipped unless the three synthetic accounts are configured.

import { existsSync, readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import pg from "pg";

const ada = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
};
const cara = {
  email: process.env.E2E_NONSTAFF_EMAIL,
  password: process.env.E2E_NONSTAFF_PASSWORD,
};
const dan = {
  email: process.env.E2E_NOORG_EMAIL,
  password: process.env.E2E_NOORG_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  ![ada, cara, dan].every((a) => a.email && a.password) ||
    !existsSync(".data/dev-db.json"),
  "Needs the local synthetic stack and E2E_EMAIL/E2E_NONSTAFF_*/E2E_NOORG_*",
);
test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };

async function localAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const env = readFileSync(".env.development.local", "utf8");
  const url = new URL(env.match(/^AUTH_DATABASE_URL=(.*)$/m)![1]!.trim());
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Refusing a non-local database");
  url.username = "postgres";
  url.password = JSON.parse(
    readFileSync(".data/dev-db.json", "utf8"),
  ).superPassword;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

test.beforeAll(async () => {
  await localAdmin(async (c) => {
    const ids = `(SELECT id FROM "user" WHERE email IN ('${ada.email}', '${cara.email}'))`;
    await c.query(`DELETE FROM mfa_recovery_code WHERE user_id IN ${ids}`);
    await c.query(`DELETE FROM user_mfa WHERE user_id IN ${ids}`);
    await c.query(
      `DELETE FROM platform_staff WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
      [cara.email],
    );
    await c.query(`UPDATE session SET mfa_verified_at = NULL`);
    // Integration settings (M5.3) start empty on every run (local only).
    await c.query(`DELETE FROM integration_active WHERE environment = 'local'`);
    await c.query(`DELETE FROM integration_config WHERE environment = 'local'`);
    await c.query(`DELETE FROM platform_setting WHERE key = 'ai.controls'`);
  });
});

async function signIn(
  browser: Browser,
  info: TestInfo,
  account: { email?: string; password?: string },
) {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.getByLabel("Email address").fill(account.email!);
  await page.getByLabel("Password").fill(account.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|organisations)$/, SLOW);
  return { context, page };
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, label).toEqual([]);
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (shots)
    await page.screenshot({
      path: `${shots}/${info.project.name}-${name}.png`,
      fullPage: true,
    });
}

const totp = (key: string) =>
  new TOTP({
    secret: Secret.fromBase32(key.replace(/\s/g, "")),
    digits: 6,
    period: 30,
  }).generate();

const codeInput = (page: Page) =>
  page.getByLabel(/6-digit code|Recovery code/).filter({ visible: true });

test("signed-out visitors are sent to sign-in", async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await page.goto("/platform/staff", SLOW);
  // The sign-in page remembers where they were going.
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Fplatform$|\/sign-in\?next=\/platform$/,
    {
      timeout: 30_000,
    },
  );
  await context.close();
});

test("people who aren't platform staff get a 404", async ({
  browser,
}, info) => {
  const { context, page } = await signIn(browser, info, dan);
  for (const path of [
    "/platform",
    "/platform/staff",
    "/platform/mfa/setup",
    "/platform/audit",
  ]) {
    await page.goto(path, SLOW);
    await expect(
      page.getByRole("heading", { name: /Platform|Set up multi-factor/ }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/not found|couldn.t find/i).first(),
    ).toBeVisible();
  }
  await context.close();
});

test("staff must set up MFA, then manage staff with an audit trail", async ({
  browser,
}, info) => {
  // One long journey through the console (MFA, staff, organisations,
  // integrations), so it gets more than the default 30 seconds.
  test.setTimeout(300_000);
  // Signed out, open Platform Admin directly: after signing in, staff land in
  // Platform Admin (MFA set-up first), not the client dashboard.
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await page.goto("/platform/staff", SLOW);
  await expect(page).toHaveURL(/\/sign-in\?next=/, SLOW);
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.getByLabel("Email address").fill(ada.email!);
  await page.getByLabel("Password").fill(ada.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/platform\/mfa\/setup$/, SLOW);
  await axe(page, "mfa setup");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const key = (await page.getByTestId("mfa-manual-key").innerText()).trim();
  await codeInput(page).fill("000000");
  await page.getByRole("button", { name: "Turn on MFA" }).click();
  await expect(page.getByText("That code didn't match").first()).toBeVisible(
    SLOW,
  );
  const setupCode = totp(key);
  await codeInput(page).fill(setupCode);
  await page.getByRole("button", { name: "Turn on MFA" }).click();
  const codes = page
    .getByRole("list", { name: "Recovery codes" })
    .getByRole("listitem");
  await expect(codes).toHaveCount(10, SLOW);
  const recovery = await codes.first().innerText();
  await axe(page, "recovery codes");
  await shot(page, info, "mfa-recovery-codes");
  await page.getByRole("button", { name: /I've saved them/ }).click();
  await expect(page).toHaveURL(/\/platform\/dashboard$/, SLOW);

  // Staff management: add Cara (an existing, verified account).
  await page.goto("/platform/staff", SLOW);
  await axe(page, "staff");
  await page
    .getByLabel("Email of an existing, verified TeamHappi account")
    .fill(cara.email!);
  await page.getByLabel("View the platform audit log").first().check();
  await page.getByRole("button", { name: "Add platform staff" }).click();
  await expect(page.getByText("Staff member added").first()).toBeVisible(SLOW);
  await page.reload();
  const caraCard = page.getByRole("region", { name: /Cara Colleague/ });
  await expect(caraCard.getByText("MFA not set up")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /\(you\)/ })
      .getByText("You can't change your own access"),
  ).toBeVisible();
  await shot(page, info, "staff");

  // Audit trail and security page.
  await page.goto("/platform/audit", SLOW);
  await expect(page.getByText("Turned on MFA").first()).toBeVisible();
  await expect(page.getByText("Added platform staff").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(recovery);
  await axe(page, "audit");
  await page.goto("/platform/security", SLOW);
  await axe(page, "security");

  // Client organisations (M5.2): directory, detail (counts only), suspend and
  // reactivate with a reason, audited.
  const HARBOUR = "Harbour & Hearth Group (synthetic)";
  await page.goto("/platform/organisations", SLOW);
  await expect(page.getByRole("link", { name: HARBOUR })).toBeVisible();
  await axe(page, "organisations");
  await shot(page, info, "organisations");
  await page.getByLabel("Search by name").fill("larder");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("link", { name: "Northern Larder Ltd (synthetic)" }),
  ).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: HARBOUR })).toHaveCount(0);
  await page.goto("/platform/organisations", SLOW);
  await page.getByRole("link", { name: HARBOUR }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: HARBOUR }),
  ).toBeVisible(SLOW);
  await expect(page.locator("main")).not.toContainText(
    /Kwame|Mensah|Aisha|Quayside/,
  );
  await axe(page, "organisation detail");
  await page.getByRole("button", { name: "Suspend organisation" }).click();
  const dialog = page.getByRole("dialog", { name: `Suspend ${HARBOUR}?` });
  await dialog
    .getByLabel("Reason (recorded in the audit log)")
    .fill("Synthetic test: payment overdue");
  await axe(page, "suspend dialog");
  await dialog.getByRole("button", { name: "Suspend" }).click();
  // After the change the page reloads: badge, controls and history all agree.
  await expect(
    page.getByRole("button", { name: "Reactivate organisation" }),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText("Suspended", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic test: payment overdue").first(),
  ).toBeVisible();
  await shot(page, info, "organisation-suspended");
  await page.getByRole("button", { name: "Reactivate organisation" }).click();
  await page
    .getByRole("dialog", { name: `Reactivate ${HARBOUR}?` })
    .getByRole("button", { name: "Reactivate" })
    .click();
  await expect(
    page.getByRole("button", { name: "Suspend organisation" }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Reactivated", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/platform/audit", SLOW);
  await expect(
    page.getByText("Suspended an organisation").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Reactivated an organisation").first(),
  ).toBeVisible();

  // Integrations (M5.3): settings are versioned, real providers can't be
  // switched on without approval, test adapters can, AI changes need a
  // recent authenticator check, and keys are shown by name only.
  await page.goto("/platform/integrations/email", SLOW);
  const resendCard = page.getByRole("region", { name: "Resend" });
  await resendCard.getByRole("button", { name: "Configure Resend" }).click();
  const configure = page.getByRole("dialog", { name: "Configure Resend" });
  await configure.getByLabel("Sender name").fill("TeamHappi (synthetic)");
  await configure.getByLabel("Sender address").fill("noreply@example.test");
  await configure.getByLabel("Sending domain").fill("example.test");
  await axe(page, "configure dialog");
  await configure.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByText("Settings saved as a new version").first(),
  ).toBeVisible(SLOW);
  await expect(resendCard.getByText(/Version 1, saved/)).toBeVisible(SLOW);
  await expect(resendCard.getByText("RESEND_API_KEY: not set")).toBeVisible();
  await resendCard.getByRole("button", { name: "Make active" }).click();
  await expect(
    resendCard.getByText(/needs your separate approval/).first(),
  ).toBeVisible(SLOW);
  await resendCard.getByRole("button", { name: "Test connection" }).click();
  await expect(resendCard.getByText(/No request was sent/).first()).toBeVisible(
    SLOW,
  );
  const devMailer = page.getByRole("region", { name: "Development mailer" });
  await devMailer.getByRole("button", { name: "Test connection" }).click();
  await expect(
    devMailer.getByText("Connection test passed.").first(),
  ).toBeVisible(SLOW);
  // The page reloads after a change; wait for the refreshed card.
  await expect(devMailer.getByText(/Version 1, saved/)).toBeVisible(SLOW);
  await devMailer.getByRole("button", { name: "Make active" }).click();
  await expect(devMailer.getByText("Active", { exact: true })).toBeVisible(
    SLOW,
  );
  await axe(page, "email integrations");
  await shot(page, info, "integrations-email");
  await page.goto("/platform/integrations", SLOW);
  await expect(
    page
      .getByRole("region", { name: "Email" })
      .getByText("Development mailer", { exact: true }),
  ).toBeVisible();
  await page.goto("/platform/integrations/credentials", SLOW);
  await expect(
    page.getByRole("cell", { name: "RESEND_API_KEY" }),
  ).toBeVisible();
  await expect(page.getByText("Not set").first()).toBeVisible();

  // AI: a stale authenticator check is refused (step-up), a fresh one works.
  await localAdmin((c) =>
    c.query(
      `UPDATE session SET mfa_verified_at = now() - interval '20 minutes'
       WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
      [ada.email],
    ),
  );
  await page.goto("/platform/integrations/ai", SLOW);
  await expect(page.getByText("Switched off").first()).toBeVisible();
  await page
    .getByLabel("Allow AI requests (turning this off is the kill switch)")
    .check();
  await page.getByRole("button", { name: "Save AI controls" }).click();
  await expect(
    page.getByText("confirm it's you with your authenticator").first(),
  ).toBeVisible(SLOW);
  await localAdmin((c) =>
    c.query(
      `UPDATE session SET mfa_verified_at = now()
       WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
      [ada.email],
    ),
  );
  await page.reload();
  await page.getByLabel("Spend cap per month (£)").fill("12.505");
  await page.getByRole("button", { name: "Save AI controls" }).click();
  await expect(page.getByText("Enter an amount in pounds").first()).toBeVisible(
    SLOW,
  );
  await page.getByLabel("Spend cap per month (£)").fill("12.50");
  await page.getByRole("button", { name: "Save AI controls" }).click();
  await expect(page.getByText("AI controls saved.").first()).toBeVisible(SLOW);
  await expect(page.getByLabel("Spend cap per month (£)")).toHaveValue(
    "12.50",
    SLOW,
  );
  await axe(page, "ai controls");
  await shot(page, info, "integrations-ai");
  await page.goto("/platform/audit", SLOW);
  for (const label of [
    "Saved integration settings",
    "Tested an integration",
    "Made an integration active",
    "Changed AI controls",
  ])
    await expect(page.getByText(label).first()).toBeVisible();

  // Replay: the set-up code can't be used again; a recovery code works once.
  await page.goto("/platform/mfa/verify?next=/platform/security", SLOW);
  await codeInput(page).fill(setupCode);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText(/already been used|didn't match/).first(),
  ).toBeVisible(SLOW);
  await page
    .getByRole("button", { name: "Use a recovery code instead" })
    .click();
  await codeInput(page).fill(recovery);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/platform\/security$/, SLOW);
  await page.goto("/platform/mfa/verify", SLOW);
  await page
    .getByRole("button", { name: "Use a recovery code instead" })
    .click();
  await codeInput(page).fill(recovery);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText("isn't valid or has already been used").first(),
  ).toBeVisible(SLOW);

  // Console pages pass accessibility checks.
  for (const path of [
    "/platform/dashboard",
    "/platform/integrations",
    "/platform/integrations/email",
    "/platform/integrations/ai",
    "/platform/integrations/credentials",
    "/platform/settings",
  ]) {
    await page.goto(path, SLOW);
    await axe(page, path);
  }
  await context.close();
});

test("new staff must enrol before using the console; platform access is separate from tenant roles", async ({
  browser,
}, info) => {
  const { context, page } = await signIn(browser, info, cara);
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible(SLOW);
  await page.goto("/platform/audit", SLOW);
  await expect(page).toHaveURL(/\/platform\/mfa\/setup$/, SLOW);
  await context.close();
});

test("staff who belong to no organisation land in Platform Admin after signing in", async ({
  browser,
}, info) => {
  // Temporarily make Dan (no organisation) platform staff in the LOCAL database.
  await localAdmin((c) =>
    c.query(
      `INSERT INTO platform_staff (user_id, grants)
       SELECT id, '{audit.view}' FROM "user" WHERE email = $1
       ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
      [dan.email],
    ),
  );
  try {
    const context = await browser.newContext({ ...info.project.use });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await page.getByLabel("Email address").fill(dan.email!);
    await page.getByLabel("Password").fill(dan.password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform\/mfa\/setup$/, SLOW);
    // The client dashboard points staff back to Platform Admin.
    await page.goto("/dashboard", SLOW);
    await expect(
      page.getByRole("link", { name: "Open Platform Admin" }),
    ).toBeVisible();
    await context.close();
  } finally {
    await localAdmin((c) =>
      c.query(
        `DELETE FROM platform_staff WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
        [dan.email],
      ),
    );
  }
});
