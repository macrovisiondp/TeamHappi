// M9.3 online applications against the LOCAL synthetic stack (CVs go to
// .data/blob-store/; run the production build with CI=true):
//   Ada - owner of Harbour & Hearth: opens a vacancy and creates its link.
//   A signed-out visitor applies with a synthetic CV.
//   Ada sees the application at Applied, from the careers page, with the CV.

import { existsSync, readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
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

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

/** Clears the local rate limits so repeated local runs can apply again. */
async function clearThrottle() {
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
    await c.query("DELETE FROM public_apply_throttle");
  } finally {
    await c.end();
  }
}

test("a visitor applies from the share link with a CV; the owner sees it in the pipeline", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  await clearThrottle();
  const title = `Runner ${RUN}-${info.project.name}`;
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  await page.goto("/recruitment/vacancies/new", SLOW);
  await page.getByLabel("Vacancy title").fill(title);
  await page.getByLabel("Job title on hire").fill("Food runner");
  await page.getByRole("button", { name: "Create vacancy" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible(SLOW);
  await page.getByLabel("Vacancy status").selectOption("open");
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible(
    SLOW,
  );
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareUrl = page.getByRole("textbox", {
    name: "Share link",
    exact: true,
  });
  await expect(shareUrl).toHaveValue(/\/jobs\/[A-Za-z0-9]{12}$/, SLOW);
  const path = new URL(await shareUrl.inputValue()).pathname;
  const vacancyUrl = page.url();

  // The visitor: no account. The logo isn't a link into TeamHappi.
  const visitorContext = await browser.newContext({ ...info.project.use });
  const visitor = await visitorContext.newPage();
  await visitor.goto(`${path}?s=qr`, SLOW);
  await expect(
    visitor.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible(SLOW);
  await expect(visitor.getByRole("banner").getByRole("link")).toHaveCount(0);
  await axe(visitor, "public application form");

  // Missing details are explained.
  await visitor.getByRole("button", { name: "Send application" }).click();
  await expect(visitor.getByText("Check the highlighted fields.")).toBeVisible(
    SLOW,
  );
  await expect(
    visitor.getByText("Confirm you've read the privacy notice"),
  ).toBeVisible();

  const email = `online-${RUN}-${info.project.name}@example.test`;
  await visitor.getByLabel("First name").fill("Online");
  await visitor.getByLabel("Last name").fill("Applicant");
  await visitor.getByLabel("Email address").fill(email);
  await visitor.getByLabel("CV (optional)").setInputFiles({
    name: "Online Applicant CV.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await visitor.getByText(/Privacy notice: how/).click();
  await expect(visitor.getByText(/kept for about 6 months/)).toBeVisible();
  await visitor.getByLabel(/I.ve read the privacy notice/).check();
  await shot(visitor, info, "public-apply-form");
  await visitor.getByRole("button", { name: "Send application" }).click();
  await expect(
    visitor.getByText(
      /Harbour & Hearth Group \(synthetic\) has your application/,
    ),
  ).toBeVisible(SLOW);
  await axe(visitor, "application received");
  await shot(visitor, info, "public-apply-received");
  await visitorContext.close();

  // The owner sees it at Applied, from the careers page, with the CV.
  await page.goto(vacancyUrl, SLOW);
  await page.getByRole("link", { name: "Online Applicant" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Online Applicant" }),
  ).toBeVisible(SLOW);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Careers page")).toBeVisible();
  const cv = page.getByRole("region", { name: "CV", exact: true });
  await expect(
    cv.locator("p", { hasText: "Online Applicant CV.pdf" }),
  ).toBeVisible();
  await expect(cv.getByText(/uploaded by the candidate/)).toBeVisible();
  await shot(page, info, "public-apply-owner-view");

  await context.close();
});
