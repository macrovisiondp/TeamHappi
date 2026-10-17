// Platform Admin: server-side access control, accessibility and disabled
// privileged actions.
//
// Needs the local stack (npm run dev:db && npm run dev:seed && npm run dev),
// where .env.development.local lists ada.verified@example.test as preview staff:
//   E2E_EMAIL=ada… E2E_PASSWORD=… E2E_NONSTAFF_EMAIL=cara… E2E_NONSTAFF_PASSWORD=…
//   PORT=3000 npx playwright test platform-admin --workers=1
// Skipped when the variables are not set (CI has no authentication database).

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const staff = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
};
const nonStaff = {
  email: process.env.E2E_NONSTAFF_EMAIL,
  password: process.env.E2E_NONSTAFF_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  !staff.email || !staff.password || !nonStaff.email || !nonStaff.password,
  "Set E2E_EMAIL/E2E_PASSWORD and E2E_NONSTAFF_EMAIL/E2E_NONSTAFF_PASSWORD (synthetic accounts)",
);
test.describe.configure({ mode: "serial" });

const PAGES = [
  { path: "/platform/dashboard", heading: "Platform overview" },
  { path: "/platform/integrations", heading: "Integrations" },
  { path: "/platform/integrations/email", heading: "Email" },
  {
    path: "/platform/integrations/storage",
    heading: "File and document storage",
  },
  { path: "/platform/integrations/payments", heading: "Payments" },
  { path: "/platform/integrations/ai", heading: "AI" },
  { path: "/platform/integrations/credentials", heading: "Credentials" },
  { path: "/platform/integrations/audit", heading: "Integration audit log" },
  { path: "/platform/settings", heading: "Platform settings" },
];

async function signedInPage(
  browser: Browser,
  info: TestInfo,
  account: { email?: string; password?: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  await page.goto("/sign-in");
  // Wait for hydration so the form is handled by the app, not the browser.
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page.getByLabel("Email address").fill(account.email!);
  await page.getByLabel("Password").fill(account.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|organisations)$/, {
    timeout: 60_000,
  });
  return { context, page };
}

let staffContext: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }, info) => {
  ({ context: staffContext, page } = await signedInPage(browser, info, staff));
});
test.afterAll(async () => {
  await staffContext?.close();
});

test("signed-out visitors are sent to sign-in", async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use });
  const anon = await context.newPage();
  await anon.goto("/platform/integrations/credentials", { timeout: 60_000 });
  await expect(anon).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
  await context.close();
});

test("signed-in users who are not platform staff get a 404", async ({
  browser,
}, info) => {
  const { context, page: other } = await signedInPage(browser, info, nonStaff);
  for (const path of [
    "/platform",
    "/platform/dashboard",
    "/platform/integrations/credentials",
  ]) {
    await other.goto(path, { timeout: 60_000 });
    await expect(
      other.getByRole("heading", { name: "Platform overview" }),
    ).toHaveCount(0);
    await expect(
      other.getByText(/not found|couldn.t find/i).first(),
    ).toBeVisible();
  }
  // Tenant pages still work for them.
  await other.goto("/dashboard");
  await expect(
    other.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible();
  await context.close();
});

test("platform pages pass automated accessibility checks", async ({}, info) => {
  for (const screen of PAGES) {
    await page.goto(screen.path, { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: screen.heading }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, `${screen.path} (${info.project.name})`).toEqual(
      [],
    );
    if (shots) {
      const name = screen.path.slice(1).replace(/\//g, "_");
      await page.screenshot({
        path: `${shots}/${info.project.name}-${name}.png`,
        fullPage: true,
      });
    }
  }
});

test("privileged actions are disabled and secrets are never shown", async () => {
  await page.goto("/platform/integrations/email");
  await expect(page.getByText("Demo data").first()).toBeVisible();
  for (const button of await page
    .getByRole("button", { name: /^(Configure|Test connection|Make active)/ })
    .all())
    await expect(button).toBeDisabled();
  await page.goto("/platform/integrations/credentials");
  await expect(
    page.getByRole("button", { name: "Rotate a credential" }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/sk_|whsec_|AKIA/);
  await page.goto("/platform/integrations/ai");
  await expect(page.getByRole("button", { name: "Turn AI on" })).toBeDisabled();
  await expect(page.getByText("Switched off").first()).toBeVisible();
});

test("platform navigation is separate from tenant navigation", async ({}, info) => {
  await page.goto("/platform/dashboard");
  if (info.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await drawer.getByRole("link", { name: /^Credentials/ }).click();
  } else {
    const nav = page.getByRole("navigation", { name: "Platform" });
    await expect(nav.getByRole("link", { name: /^People/ })).toHaveCount(0);
    await nav.getByRole("link", { name: /^Credentials/ }).click();
  }
  await expect(page).toHaveURL(/\/platform\/integrations\/credentials$/);
  await expect(page.getByLabel("Organisation")).toHaveCount(0);
});
