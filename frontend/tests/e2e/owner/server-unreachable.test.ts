import { test, expect } from "@playwright/test";
import { createOwner, loginAs } from "../helpers/api";

const RUN_ID = Date.now().toString();

/**
 * A server that doesn't answer is not a server that says no (Oct 2026). The
 * saved sign-in was dropped on any failure, so a backend still waking from
 * Render's sleep signed the owner out. Now only a 401 does; no answer keeps
 * the sign-in and offers to try again. On the owner's iPad, with touch.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

test("no answer keeps the owner signed in, and Try again carries on", async ({ page, request }) => {
  const { token } = await createOwner(request, `unreach-${RUN_ID}`);
  await loginAs(page, token);

  await page.route("**/api/me", (route) => route.abort("connectionrefused"));
  await page.goto("/dashboard");
  await expect(page.getByText("Couldn't reach the server")).toBeVisible();
  await expect(page.getByText("You're still signed in.", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await page.evaluate(() => localStorage.getItem("hostel_token"))).toBe(token);

  await page.unroute("**/api/me");
  await page.getByRole("button", { name: "Try again" }).tap();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
});

test("a server that says no still signs the owner out", async ({ page, request }) => {
  const { token } = await createOwner(request, `unreach-401-${RUN_ID}`);
  await loginAs(page, token);
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid token" }) }));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
