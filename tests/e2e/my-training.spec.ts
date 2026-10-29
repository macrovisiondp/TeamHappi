// M8.2 My training against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada - owner of Harbour & Hearth: adds a read-and-confirm course with a rule
//   for one new person, and invites them from their record.
//   The new person (synthetic, created by this test) creates an account and
//   reads and confirms the course on their phone, in "My training".
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
const COURSE = "Safeguarding awareness (suggested)";

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

test("a new starter reads and confirms their training on My training", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const run = `${info.project.name.slice(0, 1)}${String(Date.now()).slice(-6)}`;
  const name = `Lou Learner${run}`;
  const email = `lou.learner.${run}@example.test`;
  const password = `Synthetic-${Date.now()}-pass`;
  const employeeId = await localAdmin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, email, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Lou', $2, $3, 'Host',
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'active', current_date
       FROM tenant t WHERE t.legal_name = $4 RETURNING id`,
      [`E2E-L${run}`, `Learner${run}`, email, HARBOUR],
    );
    return r.rows[0]!.id;
  });

  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // A read-and-confirm course, required for this one person.
  await page.goto("/training/courses", SLOW);
  await page.getByRole("button", { name: "Add suggested courses" }).click();
  await expect(
    page
      .getByText(/Added \d+ suggested courses|already in your catalogue/)
      .first(),
  ).toBeVisible(SLOW);
  await page.getByRole("link", { name: COURSE }).click();
  await page.getByLabel("Applies to").selectOption("employee");
  await page
    .getByLabel("Person", { exact: true })
    .selectOption({ label: name });
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText(`Person: ${name}`).first()).toBeVisible(SLOW);

  // Invite them from their record.
  await page.goto(`/people/${employeeId}/invite`, SLOW);
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Invitation created.").first()).toBeVisible(SLOW);
  const link = await page.getByLabel("Invite link").inputValue();

  // The new person signs up and opens Training: they land on My training.
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
  await me.goto("/training", SLOW);
  await expect(me).toHaveURL(/\/training\/me$/, SLOW);
  await expect(
    me.getByRole("heading", { level: 1, name: "My training" }),
  ).toBeVisible(SLOW);
  await axe(me, "my training");
  await shot(me, info, "my-training");

  // Read it, then confirm: the box must be ticked.
  const card = me.getByRole("region", { name: COURSE, exact: true });
  await card.getByText("Read it", { exact: true }).click();
  await expect(card.getByText(/replace it with your own policy/)).toBeVisible();
  await card.getByLabel(/I.ve read and understood/).check();
  await card.getByRole("button", { name: "Confirm" }).click();
  const upToDate = me.getByRole("region", { name: "Up to date" });
  await expect(upToDate.getByText(COURSE)).toBeVisible(SLOW);
  await expect(me.getByText("Confirmed by you").first()).toBeVisible();
  await axe(me, "my training after confirming");
  await shot(me, info, "my-training-done");

  // The manager sees the confirmation on the person's training page.
  await page.goto(`/people/${employeeId}/training`, SLOW);
  const required = page.getByRole("region", { name: /Training required for/ });
  await expect(required.getByText("Up to date")).toBeVisible(SLOW);
  await expect(page.getByText("Read and confirm").first()).toBeVisible();

  await fresh.close();
  await context.close();
});
