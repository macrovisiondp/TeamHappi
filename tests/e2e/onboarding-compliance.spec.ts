// M7.2 onboarding compliance against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth: records right-to-work checks, documents
//   Cara - worker at Harbour & Hearth: can't see right-to-work records
// Each run adds one synthetic new starter (no login) to Harbour through the
// LOCAL database only. All data is synthetic.

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
const STARTER = `Rhi Checked${RUN}`;
let employeeId = "";

test.beforeAll(async () => {
  // A synthetic new starter with no login, starting in a week at Harbour's first site.
  employeeId = await localAdmin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Rhi', $2, 'Bartender',
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'pending', current_date + 7
       FROM tenant t WHERE t.legal_name = $3 RETURNING id`,
      [`E2E-R${RUN}`, `Checked${RUN}`, HARBOUR],
    );
    return r.rows[0]!.id;
  });
});

test("an owner records a right-to-work check and documents, and the starter becomes cleared to start", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Start onboarding first: not cleared, and the gaps are named.
  await page.goto("/onboarding/templates", SLOW);
  await page.getByRole("button", { name: "Add suggested templates" }).click();
  await expect(
    page.getByText(/Added \d suggested templates|already in your list/).first(),
  ).toBeVisible(SLOW);
  await page.goto(`/onboarding/new?employee=${employeeId}`, SLOW);
  await page
    .getByLabel("Template")
    .selectOption({ label: "Bar team (suggested)" });
  await page.getByRole("button", { name: "Start onboarding" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: STARTER }),
  ).toBeVisible(SLOW);
  const clearance = page.getByRole("region", { name: "Cleared to start" });
  await expect(clearance.getByText("Not cleared")).toBeVisible();
  await expect(
    clearance.getByText(
      "No recorded right-to-work check covers the start date",
    ),
  ).toBeVisible();

  // Documents: add one, try a right-to-work document (refused), record it as seen.
  await page.getByLabel("Document", { exact: true }).fill("Passport");
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(
    page
      .getByText(/Record right-to-work documents in the right-to-work check/)
      .first(),
  ).toBeVisible(SLOW);
  await page.getByLabel("Document", { exact: true }).fill("Personal licence");
  await page.getByRole("button", { name: "Add document" }).click();
  const licence = page.getByRole("region", {
    name: "Personal licence",
    exact: true,
  });
  await expect(licence).toBeVisible(SLOW);
  await licence
    .getByRole("button", { name: "Record as seen Personal licence" })
    .click();
  const seen = page.getByRole("dialog", { name: "Record Personal licence" });
  await seen.getByLabel("Expiry date (optional)").fill("2036-01-31");
  await axe(page, "record document dialog");
  await seen.getByRole("button", { name: "Save" }).click();
  await expect(licence.getByText("Seen", { exact: true })).toBeVisible(SLOW);
  await axe(page, "onboarding case with documents");
  await shot(page, info, "compliance-case-documents");

  // The right-to-work record: restricted, opened from the onboarding page.
  await page
    .getByRole("link", { name: "Open the right-to-work record" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Right to work: ${STARTER}` }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("No check recorded").first()).toBeVisible();
  await axe(page, "right-to-work record (empty)");

  // A note with a share code is refused (decision D4).
  await page.getByLabel("Home Office list").selectOption("list_a");
  await page.getByLabel("Note (optional)").fill("Share code W2X 7K9 P4R");
  await page.getByRole("button", { name: "Record check" }).click();
  await expect(
    page.getByText(/looks like a document number or share code/).first(),
  ).toBeVisible(SLOW);
  // React resets the form after each submission, so choose the list again.
  await page.getByLabel("Home Office list").selectOption("list_a");
  await page.getByLabel("Note (optional)").fill("Checked at the bar");
  await page.getByRole("button", { name: "Record check" }).click();
  await expect(page.getByText("Right-to-work check recorded.")).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("Check recorded", { exact: true })).toBeVisible(
    SLOW,
  );

  // A correction supersedes it; the earlier record stays in the history.
  await page.getByLabel("What are you recording?").selectOption("correction");
  await page
    .getByLabel("What was wrong with the current record?")
    .fill("Wrong date entered");
  await page.getByLabel("Home Office list").selectOption("list_a");
  await page.getByRole("button", { name: "Record check" }).click();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByText("Corrected")).toBeVisible(SLOW);
  await expect(page.getByText("Correction: Wrong date entered")).toBeVisible();
  await axe(page, "right-to-work record (with history)");
  await shot(page, info, "compliance-right-to-work");

  // Back on onboarding, the right-to-work gap has gone.
  await page.goto("/onboarding", SLOW);
  await expect(page.getByText("Not cleared to start")).toBeVisible(SLOW);
  await page.getByRole("link", { name: STARTER }).click();
  await expect(
    page
      .getByRole("region", { name: "Cleared to start" })
      .getByText(/A recorded check covers/),
  ).toBeVisible(SLOW);

  // The follow-up list (restricted, audited).
  await page.goto("/onboarding/right-to-work", SLOW);
  await expect(
    page.getByRole("heading", { name: "Needs attention" }),
  ).toBeVisible(SLOW);
  await axe(page, "right-to-work follow-ups");
  await shot(page, info, "compliance-follow-ups");

  // Each view of the record was audited, with no restricted detail.
  const audit = await localAdmin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event
           WHERE target_id = $1 OR detail->>'employeeId' = $1::text ORDER BY occurred_at`,
          [employeeId],
        )
      ).rows,
  );
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining(["rtw.record_viewed", "rtw.check_recorded"]),
  );
  for (const a of audit)
    expect(a.detail).not.toMatch(/list_a|Checked at the bar|Wrong date/);
  await context.close();
});

test("a worker can't see right-to-work records", async ({ browser }, info) => {
  const { context, page } = await signIn(browser, info, cara);
  await page.goto(`/people/${employeeId}/right-to-work`, SLOW);
  // Looks exactly like a person who doesn't exist (404).
  await expect(
    page.getByRole("heading", { name: "We couldn't find that person" }),
  ).toBeVisible(SLOW);
  await page.goto("/onboarding/right-to-work", SLOW);
  await expect(
    page.getByText(/Only owners, administrators and HR managers/),
  ).toBeVisible(SLOW);
  await context.close();
});
