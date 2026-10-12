import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test("home page renders", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /workforce management/i }),
    ).toBeVisible();
  });

  test("signed-out visitors to the dashboard are sent to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing here yet")).toHaveCount(0);
  });

  test("sign-in form has labelled fields and no public sign-up link", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(
      page.getByRole("link", { name: /sign up|register/i }),
    ).toHaveCount(0);
  });

  test("unknown routes return a 404 page", async ({ page }) => {
    const res = await page.goto("/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });

  test("skip link moves focus to main content", async ({ page }) => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to main content" }),
    ).toBeFocused();
  });

  for (const path of ["/", "/sign-in", "/verify-email", "/does-not-exist"]) {
    test(`no automatically detectable accessibility violations on ${path}`, async ({
      page,
    }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("API and headers", () => {
  test("health endpoint returns ok and is not cached", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.data.status).toBe("ok");
  });

  test("baseline security headers are present", async ({ request }) => {
    const res = await request.get("/");
    const headers = res.headers();
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("authentication endpoints", () => {
  test("only the allow-listed endpoints exist", async ({ request }) => {
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/reset-password",
    ]) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(404);
    }
  });
});
