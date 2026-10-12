// Authenticated screens: accessibility (axe, WCAG 2.2 AA tags), keyboard and
// responsive checks, plus review screenshots.
//
// Needs a running local stack with a SYNTHETIC verified account:
//   npm run dev:db && npm run dev:seed && npm run dev
//   E2E_EMAIL=... E2E_PASSWORD=... PORT=3000 npx playwright test app-screens
// Skipped automatically when E2E_EMAIL / E2E_PASSWORD are not set (e.g. in CI,
// which has no authentication database).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const shots = process.env.E2E_SCREENSHOTS; // directory, optional

test.skip(
  !email || !password,
  "Set E2E_EMAIL and E2E_PASSWORD (synthetic account) to run",
);

const SCREENS = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/people", heading: "People" },
  { path: "/people/emp-006", heading: "Kwame Mensah" },
  { path: "/rota", heading: "Rota" },
  { path: "/settings", heading: "Settings" },
  { path: "/access-denied", heading: "You don't have access to this" },
];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Generous: the dev server compiles routes on first use.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

// Sign in once per device profile and reuse the session, so the run stays well
// inside the sign-in rate limit (5 per minute).
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }, info) => {
  context = await browser.newContext({
    ...info.project.use,
    baseURL: info.project.use.baseURL,
  });
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("signed-in screens pass automated accessibility checks", async ({}, info) => {
  for (const screen of SCREENS) {
    await page.goto(screen.path, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", {
        level: screen.path === "/access-denied" ? 2 : 1,
        name: screen.heading,
      }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, `${screen.path} (${info.project.name})`).toEqual(
      [],
    );
    if (shots) {
      const name = screen.path.replace(/\//g, "_").replace(/^_/, "") || "home";
      await page.screenshot({
        path: `${shots}/${info.project.name}-${name}.png`,
        fullPage: true,
      });
    }
  }
});

test("demo screens are labelled and unavailable actions are disabled", async () => {
  await page.goto("/dashboard");
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish rota" }),
  ).toBeDisabled();
  await page.goto("/people");
  await expect(
    page.getByRole("button", { name: "Invite person" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Organisation")).toBeDisabled();
});

test("navigation works with the keyboard and on small screens", async ({}, info) => {
  await page.goto("/dashboard");
  if (info.project.name.startsWith("mobile")) {
    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: /^People/ }).click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(drawer).toBeHidden();
  } else {
    await page.getByRole("link", { name: /^People/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByRole("link", { name: /^People/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  // Account menu opens and closes with the keyboard.
  const account = page.getByRole("button", { name: /Account menu/ });
  await account.click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(account).toBeFocused();
});
