import { test, expect } from "@playwright/test";

/**
 * The portal's saved sign-in survives a server that doesn't answer, as the
 * owner's does (tests/e2e/owner/server-unreachable.test.ts, Oct 2026).
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test("the tenant portal keeps its sign-in too", async ({ page }) => {
  // Any token: the check never gets an answer, so it cannot be judged.
  await page.addInitScript(() => localStorage.setItem("hostel_tenant_token", "kept-token"));
  await page.route("**/tenant/me", (route) => route.abort("connectionrefused"));
  await page.goto("/my");
  await expect(page.getByText("Couldn't reach the server")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hostel_tenant_token"))).toBe("kept-token");
});
