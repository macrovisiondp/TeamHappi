// M7.3 employee onboarding against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada - owner of Harbour & Hearth: invites a new starter from their record
//   and starts their onboarding.
//   The new starter (synthetic, created by this test) opens the link, creates
//   an account, and completes their own policy acknowledgement on "My onboarding".
// Each run adds one synthetic person through the LOCAL database only.

import { existsSync, readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import pg from "pg";

const ada = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  !(ada.email && ada.password) || !existsSync(".data/dev-db.json"),
  "Needs the local synthetic stack and E2E_EMAIL/E2E_PASSWORD",
);
test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };
const HARBOUR = "Harbour & Hearth Group (synthetic)";
const POLICY = "Read the staff handbook and key policies";

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

async function chooseHarbour(page: Page) {
  await page.goto("/dashboard", SLOW);
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  const opened = page.getByText(`Here's ${HARBOUR} today.`);
  if (!(await opened.isVisible())) {
    if (!page.url().endsWith("/organisations"))
      await page.goto("/organisations", SLOW);
    await page
      .getByRole("button", { name: new RegExp(HARBOUR.replace(/[()&]/g, ".")) })
      .click();
  }
  await expect(opened).toBeVisible(SLOW);
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

test("an owner invites a new starter from their record, who completes their own onboarding task", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const run = `${info.project.name.slice(0, 1)}${String(Date.now()).slice(-6)}`;
  const name = `Tam Linked${run}`;
  const email = `tam.linked.${run}@example.test`;
  const password = `Synthetic-${Date.now()}-pass`;
  const employeeId = await localAdmin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, email, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Tam', $2, $3, 'Waiter',
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'pending', current_date + 7
       FROM tenant t WHERE t.legal_name = $4 RETURNING id`,
      [`E2E-T${run}`, `Linked${run}`, email, HARBOUR],
    );
    return r.rows[0]!.id;
  });

  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Start onboarding with a suggested template (it has a policy task for the employee).
  await page.goto("/onboarding/templates", SLOW);
  await page.getByRole("button", { name: "Add suggested templates" }).click();
  await expect(
    page.getByText(/Added \d suggested templates|already in your list/).first(),
  ).toBeVisible(SLOW);
  await page.goto(`/onboarding/new?employee=${employeeId}`, SLOW);
  await page
    .getByLabel("Template")
    .selectOption({ label: "Front of house (suggested)" });
  await page.getByRole("button", { name: "Start onboarding" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible(SLOW);

  // Invite them from their record: the address is filled in from it.
  await page.goto(`/people/${employeeId}`, SLOW);
  await expect(page.getByText("Not linked yet.")).toBeVisible(SLOW);
  await page.getByRole("link", { name: "Invite to TeamHappi" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Invite ${name} to TeamHappi`,
    }),
  ).toBeVisible(SLOW);
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  await axe(page, "invite a person");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Invitation created.").first()).toBeVisible(SLOW);
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
  await page.goto("/settings/members", SLOW);
  await expect(page.getByText(`For ${name}`)).toBeVisible(SLOW);

  // The new starter, on their own device, creates an account from the link.
  const fresh = await browser.newContext({ ...info.project.use });
  const me = await fresh.newPage();
  await me.goto(link, SLOW);
  await expect(me.getByText(email)).toBeVisible(SLOW);
  await me.getByLabel("Your name").fill(name);
  await me.getByLabel("Choose a password").fill(password);
  await me.getByLabel("Type the password again").fill(password);
  await me.getByRole("button", { name: "Create account and join" }).click();
  await expect(me).toHaveURL(/\/sign-in\?joined=1$/, SLOW);
  await me.getByLabel("Email address").fill(email);
  await me.getByLabel("Password").fill(password);
  await me.getByRole("button", { name: "Sign in" }).click();
  await expect(me).toHaveURL(/\/dashboard$/, SLOW);

  // "Onboarding" takes them to their own onboarding.
  await me.goto("/onboarding", SLOW);
  await expect(me).toHaveURL(/\/onboarding\/me$/, SLOW);
  await expect(
    me.getByRole("heading", { level: 1, name: "Welcome, Tam" }),
  ).toBeVisible(SLOW);
  await expect(me.getByText(/right to work/i)).toHaveCount(0);
  await axe(me, "my onboarding");
  await shot(me, info, "my-onboarding");

  // A policy needs the box ticked.
  const policy = me.getByRole("region", { name: POLICY, exact: true });
  await policy.getByLabel(/I.ve read and understood/).check();
  await policy.getByRole("button", { name: "Confirm" }).click();
  const done = me.getByRole("region", { name: "Done" });
  await expect(done.getByText(POLICY)).toBeVisible(SLOW);
  await expect(done.getByText("Recorded by your manager")).toHaveCount(0);
  await axe(me, "my onboarding after a task");

  // The manager sees it done by the employee, not on their behalf.
  await page.goto(`/people/${employeeId}`, SLOW);
  await expect(page.getByText("Linked to a TeamHappi login.")).toBeVisible(
    SLOW,
  );
  await page.getByRole("link", { name: "Open onboarding" }).click();
  const task = page.getByRole("region", { name: POLICY, exact: true });
  await expect(task.getByText("Done", { exact: true })).toBeVisible(SLOW);
  await expect(task.getByText(/on the employee's behalf/)).toHaveCount(0);

  await fresh.close();
  await context.close();
});
