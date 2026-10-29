// M9.2b CVs against the LOCAL synthetic stack (files go to .data/blob-store/,
// never to S3; run the production build with CI=true so it counts as local):
//   Ada - owner of Harbour & Hearth: uploads a synthetic CV, downloads it,
//         is refused a non-CV file, then removes it.
//   Cara - a worker: can't download it (not found).

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

// A tiny synthetic PDF (no personal data).
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

test("an owner uploads, downloads and removes a CV; a worker can't open it", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const title = `Porter ${RUN}-${info.project.name}`;
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);

  await page.goto("/recruitment/vacancies/new", SLOW);
  await page.getByLabel("Vacancy title").fill(title);
  await page.getByLabel("Job title on hire").fill("Kitchen porter");
  await page.getByRole("button", { name: "Create vacancy" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible(SLOW);
  await page.getByLabel("Vacancy status").selectOption("open");
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible(
    SLOW,
  );
  await page
    .getByLabel("Their email (to check)")
    .fill(`cv-${RUN}-${info.project.name}@example.test`);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(
    page.getByText("No existing candidate uses this email."),
  ).toBeVisible(SLOW);
  await page.getByLabel("First name").fill("Synthetic");
  await page.getByLabel("Last name").fill("Porter");
  await page.getByRole("button", { name: "Add applicant" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Synthetic Porter" }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("No CV yet.")).toBeVisible();

  // Not a CV: refused by content, whatever the name says.
  await page.getByLabel("CV file").setInputFiles({
    name: "cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await page.getByRole("button", { name: "Upload CV" }).click();
  await expect(
    page.getByText("Upload a PDF or a Word (.docx) file.").first(),
  ).toBeVisible(SLOW);

  await page.getByLabel("CV file").setInputFiles({
    name: "Synthetic Porter CV.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByRole("button", { name: "Upload CV" }).click();
  await expect(page.getByText("CV uploaded.")).toBeVisible(SLOW);
  await expect(
    page.getByRole("region", { name: "CV", exact: true }).locator("p", {
      hasText: "Synthetic Porter CV.pdf",
    }),
  ).toBeVisible(SLOW);
  await axe(page, "application with CV");
  await shot(page, info, "cv-uploaded");

  // Download: the same bytes, always as an attachment.
  const href = await page
    .getByRole("link", { name: /Download/ })
    .getAttribute("href");
  expect(href).toMatch(/^\/recruitment\/cv\/[0-9a-f-]{36}$/);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
  expect(Buffer.from(await res.body()).equals(PDF)).toBe(true);

  // A worker in the same organisation gets not found.
  const worker = await signIn(browser, info, cara);
  await chooseHarbour(worker.page);
  expect((await worker.page.request.get(href!)).status()).toBe(404);
  await worker.context.close();

  // Remove it: gone from the page and no longer downloadable.
  await page
    .getByRole("button", { name: "Remove Synthetic Porter CV.pdf" })
    .click();
  await page
    .getByRole("dialog", { name: "Remove this CV?" })
    .getByRole("button", { name: "Remove CV" })
    .click();
  await expect(page.getByText("No CV yet.")).toBeVisible(SLOW);
  expect((await page.request.get(href!)).status()).toBe(404);

  await context.close();
});
