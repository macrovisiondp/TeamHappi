// M4.2 organisation setup through the real UI, against the local synthetic
// seed (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth; site manager (Leeds only) at Northern Larder
//   Cara - worker at Harbour & Hearth
// Skipped unless E2E_EMAIL/E2E_PASSWORD (Ada) and E2E_NONSTAFF_* (Cara) are set.

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
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
  ![ada, cara].every((a) => a.email && a.password),
  "Set E2E_EMAIL/PASSWORD and E2E_NONSTAFF_* (synthetic accounts)",
);
test.describe.configure({ mode: "serial" });

const HARBOUR = "Harbour & Hearth Group (synthetic)";
const LARDER = "Northern Larder Ltd (synthetic)";
const SLOW = { timeout: 60_000 };

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<string, StorageState>();

async function signIn(
  browser: Browser,
  info: TestInfo,
  account: { email?: string; password?: string },
) {
  const key = `${info.project.name}:${account.email}`;
  const saved = sessions.get(key);
  const context = await browser.newContext({
    ...info.project.use,
    ...(saved ? { storageState: saved } : {}),
  });
  const page = await context.newPage();
  if (!saved) {
    await page.goto("/sign-in");
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await page
      .getByLabel("Email address")
      .filter({ visible: true })
      .fill(account.email!);
    await page
      .getByLabel("Password")
      .filter({ visible: true })
      .fill(account.password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/(dashboard|organisations)$/, SLOW);
    sessions.set(key, await context.storageState());
  }
  return { context, page };
}

/** Switch organisation through the real chooser (same-origin POST). */
async function useOrganisation(page: Page, name: string) {
  await page.goto("/organisations", SLOW);
  await page
    .locator("main form")
    .filter({ hasText: name })
    .getByRole("button")
    .click();
  await expect(page.getByText(`Here's ${name} today.`)).toBeVisible(SLOW);
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

const activeStaff = async (page: Page) => {
  await page.goto("/dashboard", SLOW);
  const card = page
    .locator("div.rounded-2xl")
    .filter({ has: page.getByText("Active staff", { exact: true }) })
    .first();
  return Number(await card.locator("p.font-heading").innerText());
};

test("an owner sets up sites, teams and people through the app", async ({
  browser,
}, info) => {
  const stamp = `${info.project.name.split("-")[0]}-${Date.now().toString(36)}`;
  const siteName = `Riverside ${stamp}`;
  const { context, page } = await signIn(browser, info, ada);
  await useOrganisation(page, HARBOUR);
  const before = await activeStaff(page);

  // Organisation settings: editable by the owner.
  await page.goto("/settings", SLOW);
  await expect(
    page.getByLabel("Organisation name").filter({ visible: true }),
  ).toHaveValue(HARBOUR);
  await axe(page, "settings");
  await shot(page, info, "settings");

  // Add a site: validation first, then success.
  await page.goto("/settings/sites/new", SLOW);
  await page.getByLabel("Postcode (optional)").fill("!!");
  await page.getByRole("button", { name: "Add site" }).click();
  const problem = page
    .getByRole("alert")
    .filter({ hasText: "There's a problem" });
  await expect(problem).toBeVisible();
  await expect(page.getByText("Enter site name").first()).toBeVisible();
  await axe(page, "site form with errors");
  await page.getByLabel("Site name").filter({ visible: true }).fill(siteName);
  await page.getByLabel("Town or city (optional)").fill("Bristol");
  await page.getByLabel("Postcode (optional)").fill("bs1 4dj");
  await page.getByRole("button", { name: "Add site" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: siteName }),
  ).toBeVisible(SLOW);
  await expect(page.getByLabel("Postcode (optional)")).toHaveValue("BS1 4DJ");
  await shot(page, info, "site");

  // Deactivate (with confirmation) and reactivate.
  await page.getByRole("button", { name: "Deactivate site" }).click();
  const dialog = page.getByRole("dialog", { name: `Deactivate ${siteName}?` });
  await expect(dialog).toBeVisible();
  await axe(page, "deactivate dialog");
  await dialog.getByRole("button", { name: "Deactivate site" }).click();
  await expect(page.getByText("Inactive").first()).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Reactivate site" }).click();
  await page
    .getByRole("dialog", { name: `Reactivate ${siteName}?` })
    .getByRole("button", { name: "Reactivate site" })
    .click();
  await expect(
    page.getByRole("button", { name: "Deactivate site" }),
  ).toBeVisible(SLOW);

  // Add a team there; a duplicate name is refused.
  for (const attempt of [1, 2]) {
    await page.goto("/settings/teams/new", SLOW);
    await page
      .getByLabel("Team name")
      .filter({ visible: true })
      .fill("Kitchen");
    await page
      .getByLabel("Site", { exact: true })
      .selectOption({ label: siteName });
    await page.getByRole("button", { name: "Add team" }).click();
    if (attempt === 1)
      await expect(
        page.getByRole("heading", { level: 1, name: "Kitchen" }),
      ).toBeVisible(SLOW);
    else
      await expect(
        page.getByText("This site already has a team with that name").first(),
      ).toBeVisible(SLOW);
  }
  await page.goto("/settings/teams", SLOW);
  await axe(page, "teams list");

  // Add a person at the new site, in the new team.
  await page.goto("/people/new", SLOW);
  await page.getByLabel("First name").filter({ visible: true }).fill("Nia");
  await page
    .getByLabel("Last name")
    .filter({ visible: true })
    .fill(`Okoro ${stamp}`);
  await page.getByLabel("Job title (optional)").fill("Line cook");
  await page
    .getByLabel("Status")
    .filter({ visible: true })
    .selectOption("active");
  await page.getByLabel("Start date (optional)").fill("2026-10-01");
  await page
    .getByLabel("Main site")
    .filter({ visible: true })
    .selectOption({ label: siteName });
  await page
    .getByRole("group", { name: "Teams" })
    .getByLabel(new RegExp(`Kitchen\\s*${siteName}`))
    .check();
  await axe(page, "add person form");
  await shot(page, info, "add-person");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Nia Okoro ${stamp}` }),
  ).toBeVisible(SLOW);
  await expect(page.getByText("Line cook")).toBeVisible();
  await axe(page, "profile");

  // Edit: "Left" needs a leaving date.
  await page.getByRole("link", { name: "Edit" }).click();
  await page
    .getByLabel("Status")
    .filter({ visible: true })
    .selectOption("left");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Enter the date they left").first()).toBeVisible(
    SLOW,
  );
  await page
    .getByLabel("Status")
    .filter({ visible: true })
    .selectOption("active");
  await page.getByLabel("Job title (optional)").fill("Chef de partie");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Chef de partie")).toBeVisible(SLOW);

  // Dashboard and People reflect the real record.
  expect(await activeStaff(page)).toBe(before + 1);
  await page.goto("/people", SLOW);
  await expect(
    page.getByRole("link", { name: `Nia Okoro ${stamp}` }).first(),
  ).toBeVisible();
  await context.close();
});

test("a site-scoped manager and a worker are limited on the server", async ({
  browser,
}, info) => {
  const { context, page } = await signIn(browser, info, ada);
  await useOrganisation(page, LARDER);

  await page.goto("/settings", SLOW);
  await expect(
    page.getByText("Only organisation owners and administrators"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Organisation name").filter({ visible: true }),
  ).toHaveCount(0);

  await page.goto("/settings/sites", SLOW);
  await expect(page.getByRole("link", { name: "Larder Leeds" })).toBeVisible();
  await expect(page.getByText("Larder York")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add site" })).toHaveCount(0);

  await page.goto("/settings/sites/new", SLOW);
  await expect(
    page.getByRole("heading", { name: "You don't have access to this" }),
  ).toBeVisible();
  await page.goto("/people/new", SLOW);
  await expect(
    page.getByRole("heading", { name: "You don't have access to this" }),
  ).toBeVisible();

  await page.goto("/settings/teams/new", SLOW);
  const options = await page
    .getByLabel("Site", { exact: true })
    .locator("option")
    .allInnerTexts();
  expect(options.filter((o) => o !== "Choose a site")).toEqual([
    "Larder Leeds",
  ]);
  await context.close();

  const worker = await signIn(browser, info, cara);
  await worker.page.goto("/settings/sites", SLOW);
  await expect(
    worker.page.getByRole("heading", { name: "You don't have access to this" }),
  ).toBeVisible();
  await expect(
    worker.page.getByLabel("Organisation name").filter({ visible: true }),
  ).toHaveCount(0);
  await axe(worker.page, "permission denied");
  await worker.context.close();
});
