// M9.2a vacancy sharing against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada - owner of Harbour & Hearth: creates a vacancy and its share link
//   A signed-out visitor opens the link (no account, nothing collected).

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

test("an owner shares a vacancy by link and QR code; a visitor sees only what's published", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const title = `Barista ${RUN}-${info.project.name}`;
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  await page.goto("/recruitment/vacancies/new", SLOW);
  await page.getByLabel("Vacancy title").fill(title);
  await page.getByLabel("Job title on hire").fill("Barista");
  await page.getByLabel("From (£) (optional)").fill("12.60");
  await page.getByLabel("Per (optional)").selectOption("hour");
  await page.getByRole("button", { name: "Create vacancy" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible(SLOW);
  await page.getByLabel("Vacancy status").selectOption("open");
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible(
    SLOW,
  );

  // Create the link, say how to apply (pay stays hidden unless ticked).
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareUrl = page.getByRole("textbox", {
    name: "Share link",
    exact: true,
  });
  await expect(shareUrl).toHaveValue(/\/jobs\/[A-Za-z0-9]{12}$/, SLOW);
  await page
    .getByLabel("How to apply (shown on the link)")
    .fill("Pop in and ask for Sam");
  await page.getByRole("button", { name: "Save public details" }).click();
  await expect(page.getByText("Saved.")).toBeVisible(SLOW);
  await expect(
    page.getByAltText("QR code for the vacancy's share link"),
  ).toBeVisible();
  await axe(page, "vacancy with share panel");
  await shot(page, info, "sharing-panel");
  const link = await shareUrl.inputValue();
  const path = new URL(link).pathname;

  // The QR download is a real PNG; the poster prints the same link.
  const png = await page.request.get(
    page.url().replace(/\/?(\?.*)?$/, "") + "/qr?format=png",
  );
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  await page.goto(
    page.url().replace(/\/recruitment\/vacancies\//, "/poster/vacancy/"),
    SLOW,
  );
  await expect(page.getByText(/We.re hiring/)).toBeVisible(SLOW);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await axe(page, "poster");
  await shot(page, info, "sharing-poster");

  // A signed-out visitor sees the published details, without pay.
  const visitorContext = await browser.newContext({ ...info.project.use });
  const visitor = await visitorContext.newPage();
  await visitor.goto(path, SLOW);
  await expect(
    visitor.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible(SLOW);
  await expect(visitor.getByText("Pop in and ask for Sam")).toBeVisible();
  await expect(visitor.getByText(/£12\.60/)).toHaveCount(0);
  await expect(visitor.getByText(/uses no cookies or tracking/)).toBeVisible();
  await axe(visitor, "public vacancy");
  await shot(visitor, info, "sharing-public-page");

  // A new link switches the old one (and printed QR codes) off.
  await page.goBack();
  await page.goto(
    page.url().replace(/\/poster\/vacancy\//, "/recruitment/vacancies/"),
    SLOW,
  );
  await page.getByRole("button", { name: "New link" }).click();
  await page
    .getByRole("dialog", { name: "Create a new link?" })
    .getByRole("button", { name: "Create new link" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Share link", exact: true }),
  ).not.toHaveValue(link, SLOW);
  await visitor.goto(path, SLOW);
  await expect(
    visitor.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible(SLOW);

  await visitorContext.close();
  await context.close();
});
