// M10.2 My shifts against the LOCAL synthetic stack (production build, CI=true):
//   Ada - owner of Harbour & Hearth: records a right-to-work check for a new
//         synthetic person, plans next week (one shift for them, one open),
//         publishes, invites them, then approves their request.
//   The new person signs up, sees their shift flagged new (and a header link),
//   asks for the open shift, and then sees it as theirs.
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

/** Monday of next week in London, as YYYY-MM-DD, plus a day offset. */
function nextWeekDay(offset: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 + offset);
  return d.toISOString().slice(0, 10);
}

test("staff see their published shifts, ask for an open one, and the manager approves", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const run = `${info.project.name.slice(0, 1)}${String(Date.now()).slice(-6)}`;
  const name = `Shay Shifter${run}`;
  const email = `shay.shifter.${run}@example.test`;
  const password = `Synthetic-${Date.now()}-pass`;
  const week = nextWeekDay(0);
  const { employeeId, siteId } = await localAdmin(async (c) => {
    const r = await c.query<{ id: string; site: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, email, job_title, primary_site_id, status, start_date)
       SELECT t.id, $1, 'Shay', $2, $3, 'Bartender',
              (SELECT s.id FROM site s WHERE s.tenant_id = t.id AND s.status = 'active' ORDER BY s.created_at LIMIT 1),
              'active', current_date
       FROM tenant t WHERE t.legal_name = $4 RETURNING id, primary_site_id AS site`,
      [`E2E-S${run}`, `Shifter${run}`, email, HARBOUR],
    );
    return { employeeId: r.rows[0]!.id, siteId: r.rows[0]!.site };
  });

  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Right to work recorded, so they can be put on shifts.
  await page.goto(`/people/${employeeId}/right-to-work`, SLOW);
  await page.getByLabel("Home Office list").selectOption("list_a");
  await page.getByRole("button", { name: "Record check" }).click();
  await expect(page.getByText("No check recorded")).toHaveCount(0, SLOW);

  // Next week: one shift for Shay (Monday), one open shift (Wednesday).
  const rota = `/rota?site=${siteId}&week=${week}`;
  const addShift = async (day: string, role: string) => {
    await page.getByRole("button", { name: "Add shift" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a shift" });
    await dialog.getByLabel("Day").selectOption(day);
    await dialog.getByLabel("Start").fill("10:00");
    await dialog.getByLabel("End").fill("16:00");
    await dialog.getByLabel("Role (optional)").fill(role);
    await dialog.getByRole("button", { name: "Add shift" }).click();
    // The card, not the hidden screen-reader label on its buttons.
    await expect(page.locator("li", { hasText: role }).first()).toBeVisible(
      SLOW,
    );
  };
  await page.goto(rota, SLOW);
  await addShift(nextWeekDay(0), `R${run}`);
  await addShift(nextWeekDay(2), `O${run}`);
  await page
    .getByRole("button", { name: new RegExp(`^Assign for .*R${run}`) })
    .click();
  const assign = page.getByRole("dialog", {
    name: "Who's working this shift?",
  });
  await assign
    .getByLabel("Person")
    .selectOption({ label: `${name} (Bartender)` });
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible(SLOW);
  const publish = page.getByRole("button", { name: "Publish week" });
  if (await publish.isVisible()) {
    await publish.click();
    await page
      .getByRole("dialog", { name: "Publish this week?" })
      .getByRole("button", { name: "Publish" })
      .click();
  }
  await expect(page.getByText("Published", { exact: true })).toBeVisible(SLOW);

  // Invite Shay; they sign up and sign in.
  await page.goto(`/people/${employeeId}/invite`, SLOW);
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Invitation created.").first()).toBeVisible(SLOW);
  const link = await page.getByLabel("Invite link").inputValue();
  const fresh = await browser.newContext({ ...info.project.use });
  const me = await fresh.newPage();
  await me.goto(link, SLOW);
  await me.getByLabel("Your name").fill(name);
  await me.getByLabel("Choose a password").fill(password);
  await me.getByLabel("Type the password again").fill(password);
  await me.getByRole("button", { name: "Create account and join" }).click();
  await expect(me).toHaveURL(/\/sign-in\?joined=1$/, SLOW);
  await me.getByLabel("Email address").fill(email);
  await me.getByLabel("Password").fill(password);
  await me.getByRole("button", { name: "Sign in" }).click();
  await expect(me).toHaveURL(/\/dashboard$/, SLOW);

  // The header points them to their shifts; Rota takes them to My shifts.
  await expect(me.getByRole("link", { name: /1 shift update/ })).toBeVisible(
    SLOW,
  );
  await me.goto("/rota", SLOW);
  await expect(me).toHaveURL(/\/rota\/me$/, SLOW);
  await expect(
    me.getByRole("heading", { level: 1, name: "My shifts" }),
  ).toBeVisible(SLOW);
  const mine = me.getByRole("listitem").filter({ hasText: `R${run}` });
  await expect(mine.getByText("New", { exact: true })).toBeVisible();
  await axe(me, "my shifts");
  await shot(me, info, "my-shifts");

  // Ask for the open shift.
  const open = me.getByRole("listitem").filter({ hasText: `O${run}` });
  await open.getByRole("button", { name: /Ask for this shift/ }).click();
  await expect(
    me
      .getByRole("listitem")
      .filter({ hasText: `O${run}` })
      .getByText(/You.ve asked for this shift/),
  ).toBeVisible(SLOW);

  // The manager approves it.
  await page.goto(rota, SLOW);
  await page
    .getByRole("button", { name: new RegExp(`^Approve ${name} for .*O${run}`) })
    .click();
  await expect(
    page.getByRole("button", { name: new RegExp(`^Approve ${name}`) }),
  ).toHaveCount(0, SLOW);

  // Shay sees it as theirs, marked new.
  await me.goto("/rota/me", SLOW);
  const approved = me
    .getByRole("region", { name: new RegExp("Week of") })
    .getByRole("listitem")
    .filter({ hasText: `O${run}` });
  await expect(approved.getByText("New", { exact: true })).toBeVisible(SLOW);

  // M10.3: they add a time they can't work (shown back to them).
  await me.getByLabel("Specific dates").check();
  await me.getByLabel("From", { exact: true }).fill(nextWeekDay(20));
  await me.getByLabel("Note for your manager (optional)").fill("Exams");
  await me.getByRole("button", { name: "Save" }).click();
  await expect(me.getByText("Exams")).toBeVisible(SLOW);
  await axe(me, "my shifts with availability");

  // They ask to drop their first shift; the manager approves; it's no longer theirs.
  await me
    .getByRole("listitem")
    .filter({ hasText: `R${run}` })
    .getByRole("button", { name: /Ask to drop/ })
    .click();
  await me
    .getByRole("dialog", { name: "Drop this shift?" })
    .getByRole("button", { name: "Ask to drop" })
    .click();
  await expect(me.getByText(/You.ve asked to drop this shift/)).toBeVisible(
    SLOW,
  );
  await page.goto(rota, SLOW);
  await expect(page.getByText(`${name} asked to drop this shift.`)).toBeVisible(
    SLOW,
  );
  await page
    .getByRole("button", { name: new RegExp(`^Approve change to .*R${run}`) })
    .click();
  await expect(page.getByText(`${name} asked to drop this shift.`)).toHaveCount(
    0,
    SLOW,
  );
  await me.goto("/rota/me", SLOW);
  await expect(
    me.getByRole("heading", { name: "No longer yours" }),
  ).toBeVisible(SLOW);
  await shot(me, info, "my-shifts-after-drop");

  // M11.1: they clock in now (no shift today, so it's flagged), take a break
  // and clock out; their time shows in their own list.
  const clock = me.getByRole("region", { name: /Not clocked in|Clocked in/ });
  await me.getByRole("button", { name: "Clock in" }).click();
  await expect(
    me.getByRole("heading", { name: /Clocked in since/ }),
  ).toBeVisible(SLOW);
  await me.getByRole("button", { name: "Start break" }).click();
  await expect(me.getByRole("heading", { name: /On a break/ })).toBeVisible(
    SLOW,
  );
  await me.getByRole("button", { name: "End break" }).click();
  await expect(me.getByRole("button", { name: "Start break" })).toBeVisible(
    SLOW,
  );
  await axe(me, "my shifts while clocked in");
  await me.getByRole("button", { name: "Clock out" }).click();
  await expect(me.getByRole("heading", { name: "Not clocked in" })).toBeVisible(
    SLOW,
  );
  await expect(clock.getByText("Your times, last 14 days")).toBeVisible();

  // The manager sees it on Who's in, flagged "No shift", and corrects it.
  await page.goto(`/attendance?site=${siteId}`, SLOW);
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("No shift", { exact: true })).toBeVisible(SLOW);
  await axe(page, "attendance");
  await row.getByRole("button", { name: /^Correct/ }).click();
  const fix = page.getByRole("dialog", { name: "Correct times" });
  const clockIn = await fix.getByLabel("Clock in").inputValue();
  await fix.getByLabel("Clock in").fill(`${clockIn.slice(0, 11)}00:01`);
  await fix.getByLabel("Reason").fill("Synthetic correction");
  await fix.getByRole("button", { name: "Save" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByText("Corrected", { exact: true }),
  ).toBeVisible(SLOW);
  await shot(page, info, "attendance");

  await fresh.close();
  await context.close();
});
