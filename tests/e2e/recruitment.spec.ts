// M9.1 recruitment against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth: vacancy, applicant, interview, hire
//   Cara - worker at Harbour & Hearth: no recruitment access
// Every applicant is synthetic (@example.test) and created through the app.

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

const RUN = String(Date.now()).slice(-6);
const VACANCY = `Weekend bartender ${RUN}`;

test("an owner recruits someone from vacancy to hire, starting onboarding", async ({
  browser,
}, info) => {
  test.setTimeout(400_000);
  const applicantName = `Ria Candidate${info.project.name.slice(0, 1)}${RUN}`;
  const email = `ria.${info.project.name.slice(0, 1)}${RUN}@example.test`;
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  // Onboarding templates for the hire step.
  await page.goto("/onboarding/templates", SLOW);
  await page.getByRole("button", { name: "Add suggested templates" }).click();
  await expect(
    page.getByText(/Added \d suggested templates|already in your list/).first(),
  ).toBeVisible(SLOW);

  // A vacancy (a draft until it's opened).
  await page.goto("/recruitment/vacancies/new", SLOW);
  await page
    .getByLabel("Vacancy title")
    .fill(`${VACANCY}-${info.project.name}`);
  await page.getByLabel("Job title on hire").fill("Bartender");
  await page.getByLabel("From (£) (optional)").fill("12.60");
  await page.getByLabel("Per (optional)").selectOption("hour");
  await axe(page, "new vacancy");
  await page.getByRole("button", { name: "Create vacancy" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${VACANCY}-${info.project.name}`,
    }),
  ).toBeVisible(SLOW);
  await page.getByLabel("Vacancy status").selectOption("open");
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible(
    SLOW,
  );

  // Add an applicant, checking for an existing candidate first.
  await page.getByLabel("Their email (to check)").fill(email);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(
    page.getByText("No existing candidate uses this email."),
  ).toBeVisible(SLOW);
  await page.getByLabel("First name").fill(applicantName.split(" ")[0]!);
  await page.getByLabel("Last name").fill(applicantName.split(" ")[1]!);
  await axe(page, "vacancy with add applicant");
  await shot(page, info, "recruitment-vacancy");
  await page.getByRole("button", { name: "Add applicant" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: applicantName }),
  ).toBeVisible(SLOW);

  // Interview stage, an interview with an outcome, then Offer.
  await page.getByLabel("Stage", { exact: true }).selectOption("interview");
  await page.getByRole("button", { name: "Move" }).click();
  await expect(
    page.getByText("Interview", { exact: true }).first(),
  ).toBeVisible(SLOW);
  await page.getByLabel("Date and time").fill("2026-12-01T10:30");
  await page.getByLabel("Where (optional)").fill("Main bar");
  await page.getByRole("button", { name: "Schedule interview" }).click();
  await expect(page.getByText(/Main bar · With/)).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Record outcome" }).click();
  const outcome = page.getByRole("dialog", { name: "Interview outcome" });
  await outcome.getByLabel("Outcome").selectOption("progress");
  await outcome
    .getByLabel("Feedback (optional)")
    .fill("Confident and friendly");
  await outcome.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Confident and friendly")).toBeVisible(SLOW);
  await page.getByLabel("Stage", { exact: true }).selectOption("offer");
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Offer", { exact: true }).first()).toBeVisible(
    SLOW,
  );
  await axe(page, "application");
  await shot(page, info, "recruitment-application");

  // Hire: creates the employee record and starts onboarding, then opens the record.
  await page.getByRole("button", { name: "Hire" }).click();
  const hire = page.getByRole("dialog", { name: `Hire ${applicantName}?` });
  await hire.getByLabel("Start date").fill("2026-12-07");
  await hire
    .getByLabel("Onboarding template")
    .selectOption({ label: "Front of house (suggested)" });
  await axe(page, "hire dialog");
  await hire.getByRole("button", { name: "Hire" }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/, SLOW);
  await expect(
    page.getByRole("heading", { level: 1, name: applicantName }),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText(`${VACANCY}-${info.project.name}`).first(),
  ).toBeVisible(); // Hired from
  await expect(
    page.getByRole("link", { name: "Open onboarding" }),
  ).toBeVisible();
  await shot(page, info, "recruitment-hired-person");

  // The vacancy shows the hire; the schedule lists the interview.
  await page.goto("/recruitment/interviews", SLOW);
  await expect(page.getByRole("link", { name: applicantName })).toBeVisible(
    SLOW,
  );
  await axe(page, "interview schedule");
  await context.close();
});

test("a worker has no recruitment access", async ({ browser }, info) => {
  const { context, page } = await signIn(browser, info, cara);
  await page.goto("/recruitment", SLOW);
  await expect(page).toHaveURL(/\/recruitment\/interviews$/, SLOW);
  await expect(
    page.getByText("Interviews you've been asked to join."),
  ).toBeVisible(SLOW);
  await expect(page.getByRole("link", { name: "Vacancies" })).toHaveCount(0);
  await page.goto("/recruitment/vacancies/new", SLOW);
  await expect(
    page.getByText(/Creating vacancies needs recruitment access/),
  ).toBeVisible(SLOW);
  await context.close();
});
