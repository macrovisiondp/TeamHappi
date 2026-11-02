// M10.1 rota against the LOCAL synthetic stack (production build, CI=true):
//   Ada - owner of Harbour & Hearth: adds a person with a right-to-work check,
//         plans a far-future week, is blocked from assigning someone without a
//         check, assigns, publishes and prints.
//   Cara - a worker: sees no rotas to manage.

import { existsSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

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

const RUN = Number(String(Date.now()).slice(-5));

/** A Monday far in the future, different per run and per browser project. */
function testWeek(project: string) {
  const d = new Date(Date.UTC(2030, 0, 7)); // a Monday
  d.setUTCDate(
    d.getUTCDate() + 7 * ((RUN % 500) + (project.includes("mobile") ? 600 : 0)),
  );
  return d.toISOString().slice(0, 10);
}

test("a manager plans a week: right-to-work block, assign, hours, publish and print", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const name = `Rhea Rota${RUN}`;
  const week = testWeek(info.project.name);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Which site the rota opens on.
  await page.goto("/rota", SLOW);
  await expect(
    page.getByRole("heading", { level: 1, name: "Rota" }),
  ).toBeVisible(SLOW);
  const siteSelect = page.getByLabel("Site", { exact: true });
  const siteId = await siteSelect.inputValue();
  const siteName = (await siteSelect
    .locator("option:checked")
    .textContent())!.trim();

  // A new person at that site, with a right-to-work check recorded.
  await page.goto("/people/new", SLOW);
  await page.getByLabel("First name").filter({ visible: true }).fill("Rhea");
  await page
    .getByLabel("Last name")
    .filter({ visible: true })
    .fill(`Rota${RUN}`);
  await page.getByLabel("Job title (optional)").fill("Bartender");
  await page
    .getByLabel("Status")
    .filter({ visible: true })
    .selectOption("active");
  await page
    .getByLabel("Main site")
    .filter({ visible: true })
    .selectOption({ label: siteName });
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible(SLOW);
  await page.goto(`${new URL(page.url()).pathname}/right-to-work`, SLOW);
  await page.getByLabel("Home Office list").selectOption("list_a");
  await page.getByRole("button", { name: "Record check" }).click();
  await expect(page.getByText("No check recorded")).toHaveCount(0, SLOW);

  // An empty week: add a shift.
  await page.goto(`/rota?site=${siteId}&week=${week}`, SLOW);
  await expect(page.getByText("No shifts this week")).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Add shift" }).click();
  const add = page.getByRole("dialog", { name: "Add a shift" });
  await add.getByLabel("Start").fill("09:00");
  await add.getByLabel("End").fill("17:00");
  await add.getByLabel("Role (optional)").fill("Bar");
  await add.getByRole("button", { name: "Add shift" }).click();
  await expect(page.getByText("09:00–17:00")).toBeVisible(SLOW);
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();

  // Someone without a right-to-work check is blocked.
  await page.getByRole("button", { name: /^Assign for/ }).click();
  const assign = page.getByRole("dialog", {
    name: "Who's working this shift?",
  });
  const person = assign.getByLabel("Person");
  const labels = await person.locator("option").allTextContents();
  const other = labels.find(
    (l) => !l.startsWith("Rhea") && !l.startsWith("Choose"),
  );
  if (other) {
    await person.selectOption({ label: other });
    await assign.getByRole("button", { name: "Assign" }).click();
    await expect(assign.getByText("This can't be assigned")).toBeVisible(SLOW);
    await expect(
      assign.getByText(/No recorded right-to-work check covers this date/),
    ).toBeVisible();
  }
  await person.selectOption({ label: labels.find((l) => l.startsWith(name))! });
  await assign.getByRole("button", { name: "Assign" }).click();
  await expect(
    page.getByRole("dialog", { name: "Who's working this shift?" }),
  ).toHaveCount(0, SLOW);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible(SLOW);
  await expect(
    page.getByRole("row", { name: new RegExp(`${name}.*7h 30m`) }),
  ).toBeVisible();
  await axe(page, "rota week");
  await shot(page, info, "rota-week");

  // Publish.
  await expect(
    page.getByText(/Staff can't see this week until it's published/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish week" }).click();
  await page
    .getByRole("dialog", { name: "Publish this week?" })
    .getByRole("button", { name: "Publish" })
    .click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: "Publish week" })).toHaveCount(
    0,
  );

  // The printable week.
  await page.goto(`/print/rota?site=${siteId}&week=${week}`, SLOW);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: new RegExp(siteName.replace(/[()&]/g, ".")),
    }),
  ).toBeVisible(SLOW);
  await expect(page.getByRole("rowheader", { name })).toBeVisible();
  await expect(page.getByText("09:00–17:00 Bar")).toBeVisible();
  await axe(page, "printable rota");
  await context.close();

  // A worker sees no rotas to manage.
  const worker = await signIn(browser, info, cara);
  await chooseHarbour(worker.page);
  await worker.page.goto("/rota", SLOW);
  await expect(worker.page.getByText("No rotas you can see")).toBeVisible(SLOW);
  await worker.context.close();
});
