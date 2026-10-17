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
