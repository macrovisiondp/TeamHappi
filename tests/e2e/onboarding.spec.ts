// M7.1 onboarding against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth: templates, onboarding, final sign-off
//   Cara - worker at Harbour & Hearth: no access to onboarding
// Each run adds one synthetic new starter (no login) to Harbour through the
// LOCAL database only, and onboards them end to end.

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
const cara = {
  email: process.env.E2E_NONSTAFF_EMAIL,
  password: process.env.E2E_NONSTAFF_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  ![ada, cara].every((a) => a.email && a.password) ||
    !existsSync(".data/dev-db.json"),
  "Needs the local synthetic stack and E2E_EMAIL/E2E_NONSTAFF_*",
);
test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };
const HARBOUR = "Harbour & Hearth Group (synthetic)";

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

const RUN = String(Date.now()).slice(-6);
const STARTER = `Olu Starter${RUN}`;
let employeeId = "";

test.beforeAll(async () => {
  // A synthetic new starter with no login, at Harbour's first site.
  employeeId = await localAdmin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Olu', $2, 'Kitchen porter',
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'pending', current_date
       FROM tenant t WHERE t.legal_name = $3 RETURNING id`,
      [`E2E-${RUN}`, `Starter${RUN}`, HARBOUR],
    );
    return r.rows[0]!.id;
  });
});

test("an owner sets up templates and onboards someone without a login to final sign-off", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Templates: suggested UK hospitality templates, clearly labelled, editable.
  await page.goto("/onboarding/templates", SLOW);
  await page.getByRole("button", { name: "Add suggested templates" }).click();
  await expect(
    page.getByText(/Added \d suggested templates|already in your list/).first(),
  ).toBeVisible(SLOW);
  const kitchen = page.getByRole("link", { name: "Kitchen team (suggested)" });
  await expect(kitchen).toBeVisible(SLOW);
  await axe(page, "templates");
  await shot(page, info, "onboarding-templates");
  await kitchen.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kitchen team (suggested)" }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("Suggested: review before use")).toBeVisible();
  await axe(page, "template");

  // Start onboarding from the person's record.
  await page.goto(`/people/${employeeId}`, SLOW);
  await expect(
    page.getByText("No onboarding yet. It works without a TeamHappi login."),
  ).toBeVisible(SLOW);
  await page.getByRole("link", { name: "Start onboarding" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Start onboarding" }),
  ).toBeVisible(SLOW);
  await page
    .getByLabel("Template")
    .selectOption({ label: "Kitchen team (suggested)" });
  await axe(page, "start onboarding");
  await page.getByRole("button", { name: "Start onboarding" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: STARTER }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("Right to work is separate")).toBeVisible();
  await axe(page, "onboarding case");
  await shot(page, info, "onboarding-case");

  // Final sign-off isn't possible while required tasks are open.
  await expect(
    page.getByRole("button", { name: "Give final sign-off" }),
  ).toBeDisabled();

  // An exception for an optional task, with a reason.
  await page
    .getByRole("button", { name: "Exception for Uniform and equipment issued" })
    .click();
  const dialog = page.getByRole("dialog", { name: /Make an exception/ });
  await dialog.getByLabel("Reason (recorded)").fill("Brings their own whites");
  await dialog.getByRole("button", { name: "Record exception" }).click();
  await expect(page.getByText("Reason: Brings their own whites")).toBeVisible(
    SLOW,
  );

  // Work through every open task, one named task at a time (each change
  // reloads the page, so wait for that task's "Done" badge each time).
  const open = await page
    .getByRole("region")
    .filter({
      has: page.getByRole("button", {
        name: /^(Mark done|Done on their behalf)$/,
      }),
    })
    .evaluateAll((els) =>
      // Task cards carry their title as aria-label; skip the outer section.
      els.map((e) => e.getAttribute("aria-label") ?? "").filter(Boolean),
    );
  expect(open.length).toBeGreaterThan(5);
  for (const title of open) {
    const card = page.getByRole("region", { name: title, exact: true });
    await card
      .getByRole("button", { name: /^(Mark done|Done on their behalf)$/ })
      .click();
    await expect(card.getByText("Done", { exact: true })).toBeVisible(SLOW);
  }
  await expect(page.getByText("Every required task is finished.")).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("Ready for sign-off").first()).toBeVisible();
  await expect(
    page.getByText("(on the employee's behalf)").first(),
  ).toBeVisible();

  // Final sign-off: separate from readiness, recorded with name and time.
  await page.getByRole("button", { name: "Give final sign-off" }).click();
  const signoff = page.getByRole("dialog", {
    name: `Sign off ${STARTER}'s onboarding?`,
  });
  await expect(
    signoff.getByText("It does not confirm right to work"),
  ).toBeVisible();
  await axe(page, "sign-off dialog");
  await signoff.getByRole("button", { name: "Sign off" }).click();
  await expect(page.getByText(/Signed off by Ada Verified/)).toBeVisible(SLOW);
  await expect(
    page.getByRole("button", { name: /^(Mark done|Reopen)$/ }),
  ).toHaveCount(0);
  await shot(page, info, "onboarding-signed-off");

  // The dashboard shows it under "Signed off".
  await page.goto("/onboarding?status=completed", SLOW);
  await expect(page.getByRole("link", { name: STARTER })).toBeVisible(SLOW);
  await axe(page, "onboarding dashboard");
  await page.goto("/onboarding", SLOW);
  await expect(page.getByText("Ready for final sign-off")).toBeVisible();
  await shot(page, info, "onboarding-dashboard");
  await context.close();
});

test("a worker can't see onboarding", async ({ browser }, info) => {
  const { context, page } = await signIn(browser, info, cara);
  await page.goto("/onboarding", SLOW);
  await expect(
    page.getByText("Your role doesn't include onboarding."),
  ).toBeVisible(SLOW);
  await page.goto("/onboarding/templates", SLOW);
  await expect(
    page.getByText(/Managing onboarding templates needs/),
  ).toBeVisible(SLOW);
  await page.goto(`/people/${employeeId}`, SLOW);
  await expect(page.getByRole("heading", { name: "Onboarding" })).toHaveCount(
    0,
  );
  await context.close();
});
