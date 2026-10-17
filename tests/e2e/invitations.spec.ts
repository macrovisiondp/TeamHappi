// M6 invitations and members against the LOCAL synthetic stack
// (npm run dev:db && npm run dev:seed && npm run dev):
//   Ada  - owner of Harbour & Hearth: invites, changes roles, suspends
//   Dan  - verified, no organisation: accepts with his existing account
// A brand-new person creates their account from the link. Dan is removed from
// Harbour again afterwards (local database only), so other suites still see
// him with no organisation.

import { existsSync, readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import pg from "pg";

const ada = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
};
const dan = {
  email: process.env.E2E_NOORG_EMAIL,
  password: process.env.E2E_NOORG_PASSWORD,
};
const shots = process.env.E2E_SCREENSHOTS;

test.skip(
  ![ada, dan].every((a) => a.email && a.password) ||
    !existsSync(".data/dev-db.json"),
  "Needs the local synthetic stack and E2E_EMAIL/E2E_NONSTAFF_*/E2E_NOORG_*",
);
test.describe.configure({ mode: "serial" });

const SLOW = { timeout: 60_000 };
const HARBOUR = "Harbour & Hearth Group (synthetic)";
const NEW_EMAIL = `new.starter.${Date.now()}@example.test`;
const NEW_PASSWORD = `Synthetic-${Date.now()}-pass`;
const NEW_NAME = `Nia Newstarter ${String(Date.now()).slice(-5)}`;

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

/** Local-only reset: Dan belongs to no organisation; no open invitations for him. */
const resetDan = () =>
  localAdmin(async (c) => {
    const uid = `(SELECT id FROM "user" WHERE email = '${dan.email}')`;
    await c.query(
      `DELETE FROM role_assignment WHERE membership_id IN (SELECT id FROM tenant_membership WHERE user_id = ${uid})`,
    );
    await c.query(`DELETE FROM tenant_membership WHERE user_id = ${uid}`);
    await c.query(
      `UPDATE invitation SET status = 'revoked', revoked_at = now() WHERE email = $1 AND status = 'pending'`,
      [dan.email],
    );
  });

/** Local-only tidy-up: people created by earlier runs leave Harbour. */
const tidyNewStarters = () =>
  localAdmin((c) =>
    c.query(
      `UPDATE tenant_membership SET status = 'left' WHERE user_id IN
         (SELECT id FROM "user" WHERE email LIKE 'new.starter.%@example.test')`,
    ),
  );

test.beforeAll(async () => {
  await resetDan();
  await tidyNewStarters();
});
test.afterAll(async () => {
  await resetDan();
  await tidyNewStarters();
});

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
// Reuse sessions so the run stays inside the sign-in rate limit (5 a minute).
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
  await expect(page).toHaveURL(/\/(dashboard|organisations)$/, SLOW);
  sessions.set(key, await context.storageState());
  return { context, page };
}

async function chooseHarbour(page: Page) {
  // Ada belongs to two organisations: make sure Harbour is the open one.
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
  await expect(page).toHaveURL(/\/dashboard$/, SLOW);
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

async function createLink(page: Page, email: string, role: string) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption({ label: role });
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Invitation created.").first()).toBeVisible(SLOW);
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
  return link;
}

test("an owner invites a new person, who creates an account and joins", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);
  await page.goto("/settings/members", SLOW);
  await expect(
    page.getByRole("heading", { level: 1, name: "Members" }),
  ).toBeVisible(SLOW);
  await axe(page, "members");
  const link = await createLink(page, NEW_EMAIL, "Worker");
  await expect(page.getByText(NEW_EMAIL).first()).toBeVisible(SLOW); // open invitations list
  await shot(page, info, "members-invite");

  // The new person, signed out, opens the link.
  const fresh = await browser.newContext({ ...info.project.use });
  const invitee = await fresh.newPage();
  await invitee.goto(link, SLOW);
  await expect(invitee.getByText(HARBOUR, { exact: true })).toBeVisible(SLOW);
  await expect(invitee.getByText(NEW_EMAIL)).toBeVisible();
  expect(new URL(invitee.url()).hash).toBe(""); // the token is removed from the address bar
  await axe(invitee, "invite page");
  await shot(invitee, info, "invite-create-account");
  await invitee.getByLabel("Your name").fill(NEW_NAME);
  await invitee.getByLabel("Choose a password").fill(NEW_PASSWORD);
  await invitee
    .getByLabel("Type the password again")
    .fill("something-else-entirely");
  await invitee
    .getByRole("button", { name: "Create account and join" })
    .click();
  await expect(
    invitee.getByText("The passwords don't match").first(),
  ).toBeVisible(SLOW);
  await invitee.getByLabel("Type the password again").fill(NEW_PASSWORD);
  await invitee
    .getByRole("button", { name: "Create account and join" })
    .click();
  await expect(invitee).toHaveURL(/\/sign-in\?joined=1$/, SLOW);
  await expect(invitee.getByText("Your account is ready.")).toBeVisible();
  await invitee.getByLabel("Email address").fill(NEW_EMAIL);
  await invitee.getByLabel("Password").fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: "Sign in" }).click();
  await expect(invitee).toHaveURL(/\/dashboard$/, SLOW);
  await expect(invitee.getByText(`Here's ${HARBOUR} today.`)).toBeVisible(SLOW);
  // A worker can't open the members page.
  await invitee.goto("/settings/members", SLOW);
  await expect(
    invitee.getByText("Your role doesn't include managing members."),
  ).toBeVisible(SLOW);

  // The link works once.
  const again = await (
    await browser.newContext({ ...info.project.use })
  ).newPage();
  await again.goto(link, SLOW);
  await expect(again.getByText("already been used")).toBeVisible(SLOW);

  // The owner sees the new member, suspends them, and their access stops.
  await page.reload();
  const row = page.getByRole("row", { name: new RegExp(NEW_NAME) });
  await expect(row.getByText("Active", { exact: true })).toBeVisible(SLOW);
  await row.getByRole("button", { name: `Suspend for ${NEW_NAME}` }).click();
  await page
    .getByRole("dialog", { name: `Suspend ${NEW_NAME}?` })
    .getByRole("button", { name: "Suspend" })
    .click();
  await expect(
    page
      .getByRole("row", { name: new RegExp(NEW_NAME) })
      .getByText("Suspended", { exact: true }),
  ).toBeVisible(SLOW);
  await invitee.goto("/dashboard", SLOW);
  await expect(invitee.getByText(`Here's ${HARBOUR} today.`)).toHaveCount(0);
  // Restore, then change their role to site manager at one site.
  await page
    .getByRole("row", { name: new RegExp(NEW_NAME) })
    .getByRole("button", { name: `Restore access for ${NEW_NAME}` })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore access" })
    .click();
  await expect(
    page
      .getByRole("row", { name: new RegExp(NEW_NAME) })
      .getByText("Active", { exact: true }),
  ).toBeVisible(SLOW);
  await page
    .getByRole("row", { name: new RegExp(NEW_NAME) })
    .getByRole("button", { name: `Change role for ${NEW_NAME}` })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Change ${NEW_NAME}'s role`,
  });
  await dialog.getByLabel("Role").selectOption({ label: "Site manager" });
  await dialog.getByLabel("Site").selectOption({ index: 1 });
  await axe(page, "change role dialog");
  await dialog.getByRole("button", { name: "Save role" }).click();
  await expect(
    page
      .getByRole("row", { name: new RegExp(NEW_NAME) })
      .getByText(/Site manager \(/),
  ).toBeVisible(SLOW);
  // The owner's own row can't be changed.
  await expect(
    page.getByText("You can't change your own access"),
  ).toBeVisible();
  await expect(
    page.getByText("Joined from an invitation").first(),
  ).toBeVisible();
  await expect(page.getByText("Suspended a member").first()).toBeVisible();
  await shot(page, info, "members-list");
  await fresh.close();
  await context.close();
});

test("someone with an account accepts while signed in; links can be renewed and cancelled", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const { context, page } = await signIn(browser, info, ada);
  await chooseHarbour(page);
  await page.goto("/settings/members", SLOW);
  const first = await createLink(page, dan.email!, "Worker");

  // A new link replaces the old one.
  await page.reload();
  const card = page.getByRole("region", {
    name: `Invitation for ${dan.email}`,
  });
  await card.getByRole("button", { name: `New link for ${dan.email}` }).click();
  const second = await page
    .getByLabel(`New invite link for ${dan.email}`)
    .inputValue();
  expect(second).not.toBe(first);

  const { context: danContext, page: danPage } = await signIn(
    browser,
    info,
    dan,
  );
  await danPage.goto(first, SLOW);
  await expect(danPage.getByText("isn't valid")).toBeVisible(SLOW);
  await danPage.goto(second, SLOW);
  await expect(danPage.getByText(HARBOUR, { exact: true })).toBeVisible(SLOW);
  await danPage.getByRole("button", { name: `Join ${HARBOUR}` }).click();
  await expect(danPage).toHaveURL(/\/dashboard$/, SLOW);
  await expect(danPage.getByText(`Here's ${HARBOUR} today.`)).toBeVisible(SLOW);

  // Cancelling: create and cancel one for a new address.
  const cancelled = `cancel.me.${Date.now()}@example.test`;
  const link = await createLink(page, cancelled, "Worker");
  await page.reload();
  await page
    .getByRole("region", { name: `Invitation for ${cancelled}` })
    .getByRole("button", { name: `Cancel invitation for ${cancelled}` })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel invitation" })
    .click();
  await expect(
    page.getByRole("region", { name: `Invitation for ${cancelled}` }),
  ).toHaveCount(0, SLOW);
  await danPage.goto(link, SLOW);
  await expect(danPage.getByText("cancelled")).toBeVisible(SLOW);

  await Promise.all([danContext.close(), context.close()]);
});
