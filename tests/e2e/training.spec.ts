// M8.1 training against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth: sets up courses and rules, records training
//   Cara - worker at Harbour & Hearth: no access to training management
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
const COURSE = "Allergen awareness (suggested)";

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
let employeeId = "";
let jobTitle = "";

test.beforeAll(async () => {
  // A synthetic person with a job title unique to this run, at Harbour's first site.
  jobTitle = `Mixologist ${RUN}`;
  employeeId = await localAdmin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Bo', $2, $3,
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'active', current_date - 30
       FROM tenant t WHERE t.legal_name = $4 RETURNING id`,
      [`E2E-B${RUN}`, `Trainee${RUN}`, jobTitle, HARBOUR],
    );
    return r.rows[0]!.id;
  });
});

test("an owner sets up a course and a rule, sees the matrix, and records and corrects training", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // The course catalogue, with editable suggestions.
  await page.goto("/training/courses", SLOW);
  await page.getByRole("button", { name: "Add suggested courses" }).click();
  await expect(
    page
      .getByText(/Added \d+ suggested courses|already in your catalogue/)
      .first(),
  ).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: COURSE })).toBeVisible(SLOW);
  await axe(page, "courses");
  await shot(page, info, "training-catalogue");

  // A rule: everyone with this run's job title, within 14 days.
  await page.getByRole("link", { name: COURSE }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: COURSE }),
  ).toBeVisible(SLOW);
  await page.getByLabel("Applies to").selectOption("job_title");
  await page.getByLabel("Job title", { exact: true }).fill(jobTitle);
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText(`Job title: ${jobTitle}`).first()).toBeVisible(
    SLOW,
  );
  await axe(page, "course with rules");

  // The matrix: the new rule applies automatically (existing staff: due in 14 days).
  await page.goto(`/training?job=${encodeURIComponent(jobTitle)}`, SLOW);
  const row = page.getByRole("row", { name: new RegExp(`Bo Trainee${RUN}`) });
  await expect(row.getByText("Due", { exact: true })).toBeVisible(SLOW);
  await axe(page, "training matrix");
  await shot(page, info, "training-matrix");

  // Record a certificate on the person's training page.
  await row.getByRole("link", { name: `Bo Trainee${RUN}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Training: Bo Trainee${RUN}` }),
  ).toBeVisible(SLOW);
  await page
    .getByLabel("Course", { exact: true })
    .selectOption({ label: COURSE });
  await page.getByLabel("Completed on").fill("2026-01-15");
  await page
    .getByLabel("Training provider (optional)")
    .fill("Synthetic Training Ltd");
  await page.getByLabel("Certificate reference (optional)").fill("SYN-0001");
  await page.getByRole("button", { name: "Record training" }).click();
  await expect(page.getByText("Training recorded.")).toBeVisible(SLOW);
  const required = page.getByRole("region", { name: /Training required for/ });
  await expect(required.getByText("Up to date")).toBeVisible(SLOW);

  // Correct it: the old record is kept, marked void, with the reason.
  await page.getByRole("button", { name: `Correct ${COURSE} record` }).click();
  const dialog = page.getByRole("dialog", { name: `Correct ${COURSE}` });
  await dialog
    .getByLabel("What was wrong (recorded)")
    .fill("Wrong completion date");
  await dialog.getByLabel("Completed on").fill("2026-01-20");
  await axe(page, "correction dialog");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText(/Void: Wrong completion date/)).toBeVisible(SLOW);
  await expect(page.getByText("Correction", { exact: true })).toBeVisible();
  await axe(page, "person training");
  await shot(page, info, "training-person");

  // The person page shows a training summary.
  await page.goto(`/people/${employeeId}`, SLOW);
  const card = page.getByRole("region", { name: "Training" });
  await expect(card.getByText("Up to date")).toBeVisible(SLOW);
  await shot(page, info, "training-profile-card");
  await context.close();
});

test("a worker can't see training management", async ({ browser }, info) => {
  const { context, page } = await signIn(browser, info, cara);
  await page.goto("/training", SLOW);
  await expect(
    page.getByText("Your role doesn't include training."),
  ).toBeVisible(SLOW);
  await page.goto("/training/courses", SLOW);
  await expect(page.getByText(/Managing training courses needs/)).toBeVisible(
    SLOW,
  );
  await page.goto(`/people/${employeeId}/training`, SLOW);
  await expect(
    page.getByRole("heading", { name: "We couldn't find that person" }),
  ).toBeVisible(SLOW);
  await context.close();
});
