import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, loginAs, loginOwner } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();
const PASSWORD = "testpassword123"; // what helpers/api.ts createOwner signs up with
const SESSION_ENDED = "your session has ended — sign in again";

/**
 * The owner's account screen (UX audit B3). Before it, an owner could neither
 * change nor recover a password, and sign-out was local only: a tester
 * captured a token, signed out, and /api/me still answered 200.
 */

async function me(request: APIRequestContext, token: string) {
  return request.get(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
}

async function login(request: APIRequestContext, email: string, password: string) {
  return request.post(`${BASE}/auth/login`, { data: { email, password } });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Owner account", () => {
  test("changing the password ends every other session and keeps this one", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `acct-pw-${RUN_ID}`);
    // A second device, signed in on its own.
    const { token: otherDevice } = await loginOwner(request, owner.email);
    expect((await me(request, otherDevice)).status()).toBe(200);

    await loginAs(page, token);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();

    // Anchored regexes, not exact strings: a required Field's label carries an
    // asterisk, and a bare "New password" would also match "Confirm new password".
    const current = page.getByLabel(/^Current password/);
    const next = page.getByLabel(/^New password/);
    const again = page.getByLabel(/^Confirm new password/);
    const submit = page.getByRole("button", { name: "Change password" });

    // A wrong current password is a form error — not a 401, which every client
    // would read as "you have been signed out".
    await current.fill("not-my-password");
    await next.fill("a-new-password-9");
    await again.fill("a-new-password-9");
    await submit.click();
    await expect(page.getByText("Your current password is not correct.")).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);

    // A mismatched confirmation never reaches the server.
    await current.fill(PASSWORD);
    await again.fill("a-new-password-8");
    await submit.click();
    await expect(page.getByText("The two new passwords do not match.")).toBeVisible();

    await again.fill("a-new-password-9");
    await submit.click();
    await expect(page.getByText("Password changed — every other device is signed out")).toBeVisible();

    // Both earlier tokens are dead: the other device's, and the one this page
    // started with. The message says why, rather than "invalid token".
    for (const old of [otherDevice, token]) {
      const res = await me(request, old);
      expect(res.status()).toBe(401);
      expect((await res.json()).error).toBe(SESSION_ENDED);
    }

    // This device carries on, on the token the change handed back. Navigated
    // client-side on purpose: a reload would re-run loginAs's init script and
    // put the old token back.
    const fresh = await page.evaluate(() => localStorage.getItem("hostel_token"));
    expect(fresh).not.toBe(token);
    expect((await me(request, fresh!)).status()).toBe(200);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Collections" }).click();
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page).toHaveURL(/\/collections$/);

    // The old password no longer works; the new one does.
    expect((await login(request, owner.email, PASSWORD)).status()).toBe(401);
    expect((await login(request, owner.email, "a-new-password-9")).status()).toBe(200);
  });

  test("sign out everywhere ends this session and every other, and keeps the password", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `acct-all-${RUN_ID}`);
    const { token: otherDevice } = await loginOwner(request, owner.email);

    await loginAs(page, token);
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out everywhere" }).click();

    // It asks first: this signs out a phone that may be in someone's hand.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("this one included");
    await dialog.getByRole("button", { name: "Sign out everywhere" }).click();

    await expect(page).toHaveURL(/\/login\?signed_out=everywhere$/);
    await expect(page.getByText("Signed out on every device.")).toBeVisible();

    for (const old of [token, otherDevice]) {
      const res = await me(request, old);
      expect(res.status()).toBe(401);
      expect((await res.json()).error).toBe(SESSION_ENDED);
    }
    expect((await login(request, owner.email, PASSWORD)).status()).toBe(200);
  });

  for (const vp of [
    { name: "a 375px phone", width: 375, height: 812 },
    { name: "an iPad in portrait", width: 768, height: 1024 },
    { name: "an iPad in landscape", width: 1024, height: 768 },
  ]) {
    test(`the account screen is one step from anywhere on ${vp.name}`, async ({ page, request }) => {
      const { token } = await createOwner(request, `acct-vp${vp.width}-${RUN_ID}`);
      await loginAs(page, token);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/dashboard");

      // Below 1024px it lives behind the avatar menu; from 1024 it is the
      // name at the foot of the sidebar. An iPad sits on both sides of that line.
      if (vp.width < 1024) {
        await page.getByRole("button", { name: "Account menu" }).click();
        await page.getByRole("link", { name: "Account & password", exact: true }).click();
      } else {
        await page.getByRole("link", { name: /Account & password/ }).click();
      }

      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      const button = await page.getByRole("button", { name: "Change password" }).boundingBox();
      expect(button!.x + button!.width).toBeLessThanOrEqual(vp.width);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});
