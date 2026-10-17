// M4.1 real organisation workspaces against the local synthetic seed
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth; site manager of Northern Larder (Leeds only)
//   Cara - worker at Harbour & Hearth (no staff permissions)
//   Dan  - verified, member of no organisation
// Skipped unless E2E_EMAIL/E2E_PASSWORD (Ada), E2E_NONSTAFF_* (Cara) and
// E2E_NOORG_* (Dan) are set.

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
const dan = {
  email: process.env.E2E_NOORG_EMAIL,
  password: process.env.E2E_NOORG_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  ![ada, cara, dan].every((a) => a.email && a.password),
  "Set E2E_EMAIL/PASSWORD, E2E_NONSTAFF_* and E2E_NOORG_* (synthetic accounts)",
);
test.describe.configure({ mode: "serial" });

const HARBOUR = "Harbour & Hearth Group (synthetic)";
const LARDER = "Northern Larder Ltd (synthetic)";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
// One sign-in per account per device profile, then reuse the session: keeps
// the run inside the sign-in rate limit (5 per minute).
const sessions = new Map<string, StorageState>();

async function signIn(
  browser: Browser,
  info: TestInfo,
  account: { email?: string; password?: string },
) {
  const key = `${info.project.name}:${account.email}`;
  const saved = sessions.get(key);
  if (saved) {
    const context = await browser.newContext({
      ...info.project.use,
      storageState: saved,
    });
    // Callers navigate where they need to.
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.getByLabel("Email address").fill(account.email!);
  await page.getByLabel("Password").fill(account.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|organisations)$/, {
    timeout: 60_000,
  });
  sessions.set(key, await context.storageState());
  return { context, page };
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

test("an owner with two organisations chooses, switches and stays in scope", async ({
  browser,
}, info) => {
  const { context, page } = await signIn(browser, info, ada);

  // No preference yet: choose an organisation.
  await expect(page).toHaveURL(/\/organisations$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Choose an organisation" }),
  ).toBeVisible();
  await axe(page, "organisations");
  await shot(page, info, "organisations");
  await page
    .getByRole("button", { name: new RegExp(HARBOUR.replace(/[()&]/g, ".")) })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(`Here's ${HARBOUR} today.`)).toBeVisible();
  await expect(page.getByText("Demo data")).toHaveCount(0);
  await axe(page, "dashboard (owner)");
  await shot(page, info, "workspace-dashboard");

  // Owner sees everyone in Harbour, nobody from Northern Larder.
  await page.goto("/people");
  await expect(
    page.getByRole("link", { name: "Kwame Mensah" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Priya Shah")).toHaveCount(0);
  await axe(page, "people (owner)");
  await shot(page, info, "workspace-people");
  await page.getByRole("link", { name: "Kwame Mensah" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Kwame Mensah" }),
  ).toBeVisible();
  const kwameUrl = page.url();
  await axe(page, "profile");

  // Switch organisation from the header.
  await page.goto("/dashboard");
  const switcher = page.getByLabel("Organisation", { exact: true });
  const larderId = await switcher
    .locator("option", { hasText: LARDER })
    .getAttribute("value");
  await switcher.selectOption(larderId!);
  await page.getByRole("button", { name: "Switch organisation" }).click();
  await expect(page.getByText(`Here's ${LARDER} today.`)).toBeVisible();

  // Site manager for Leeds only: York staff are invisible, Harbour's are 404.
  await page.goto("/people");
  await expect(
    page.getByRole("link", { name: "Priya Shah" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Owen Hughes" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Zoe Clarke")).toHaveCount(0);
  await page.goto(kwameUrl);
  await expect(
    page.getByRole("heading", { name: "We couldn't find that person" }),
  ).toBeVisible();
  await expect(page.getByText("Kwame")).toHaveCount(0);

  await context.close();
});

test("a worker without staff permissions is refused on the server, and a forged organisation is ignored", async ({
  browser,
}, info) => {
  // Learn Northern Larder's id from Ada's switcher, then try it as Cara.
  const { context: adaCtx, page: adaPage } = await signIn(browser, info, ada);
  await adaPage.goto("/organisations");
  const larderId = await adaPage
    .locator("form", { hasText: LARDER })
    .locator('input[name="tenantId"]')
    .getAttribute("value");
  await adaCtx.close();

  const { context, page } = await signIn(browser, info, cara);
  await page.goto("/dashboard", { timeout: 60_000 });
  await expect(page.getByText(`Here's ${HARBOUR} today.`)).toBeVisible();
  await context.addCookies([
    { name: "teamhappi.org", value: larderId!, url: page.url() },
  ]);
  await page.reload();
  await expect(page.getByText(`Here's ${HARBOUR} today.`)).toBeVisible();
  await expect(page.getByText(LARDER)).toHaveCount(0);

  await page.goto("/people");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this" }),
  ).toBeVisible();

  // Switching is same-origin only: a cross-site POST is refused outright.
  const forged = await page.request.post("/api/v1/workspace/select", {
    headers: { Origin: "https://evil.example" },
    form: { tenantId: larderId! },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(403);
  await axe(page, "people (worker)");
  await context.close();
});

test("a user with no organisation gets guidance and the labelled demo", async ({
  browser,
}, info) => {
  const { context, page } = await signIn(browser, info, dan);
  await expect(
    page.getByRole("heading", {
      name: "You're not part of an organisation yet",
    }),
  ).toBeVisible();
  await axe(page, "no organisation");
  await shot(page, info, "no-organisation");
  await page.goto("/people");
  await expect(
    page.getByRole("heading", {
      name: "You're not part of an organisation yet",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Explore the demo workspace" }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/, { timeout: 60_000 });
  await expect(page.getByText("Demo workspace").first()).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await axe(page, "demo dashboard");

  // Losing the session sends you back to sign-in.
  await context.clearCookies();
  await page.goto("/people");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});
