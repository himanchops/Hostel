import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createTenantViaApi } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * One browser can hold an owner session and a tenant-portal session at once —
 * a shared front-desk machine does, all day. Signing out of either must
 * forget both (UX audit M8): a tester signed the owner out, opened /my, and
 * landed in a tenant's ledger.
 *
 * Tokens are planted by an init script that runs ONCE per tab, not with
 * loginAs(): loginAs re-plants the owner token on every navigation, which
 * would undo exactly the sign-out under test. Nor by goto-then-evaluate: a
 * logged repro showed the dev server reloading a freshly compiled route by
 * itself right after the plant, and the test's next goto raced that reload.
 * A sessionStorage flag survives reloads within the tab, so the plant happens
 * before the first page script and never again.
 */

async function tenantToken(request: APIRequestContext, ownerToken: string, suffix: string): Promise<string> {
  const tenant = await createTenantViaApi(request, ownerToken, {
    name: `Session Tenant ${suffix} ${RUN_ID}`,
    phone: `91${suffix}${RUN_ID.slice(-7)}`,
  });
  const set = await request.put(`${BASE}/api/tenants/${tenant.id}/portal-password`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { password: "portalpass1" },
  });
  expect(set.ok()).toBeTruthy();
  const login = await request.post(`${BASE}/tenant-auth/login`, {
    data: { phone: tenant.phone, password: "portalpass1" },
  });
  expect(login.ok()).toBeTruthy();
  return (await login.json()).token;
}

async function holdBoth(page: Page, owner: string, tenant: string) {
  await page.addInitScript(([o, t]) => {
    try {
      if (sessionStorage.getItem("e2e-planted")) return;
      sessionStorage.setItem("e2e-planted", "1");
      localStorage.setItem("hostel_token", o);
      localStorage.setItem("hostel_tenant_token", t);
    } catch {
      // about:blank has no storage; the first real page plants instead.
    }
  }, [owner, tenant]);
}

function stored(page: Page) {
  return page.evaluate(() => ({
    owner: localStorage.getItem("hostel_token"),
    tenant: localStorage.getItem("hostel_tenant_token"),
  }));
}

test.describe("Signing out on a shared machine", () => {
  test("owner sign-out also forgets the tenant portal session", async ({ page, request }) => {
    const { token } = await createOwner(request, `session-o-${RUN_ID}`);
    await holdBoth(page, token, await tenantToken(request, token, "1"));

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await stored(page)).toEqual({ owner: null, tenant: null });

    // The audit's path: straight to the portal. It must ask who you are.
    await page.goto("/my");
    await expect(page).toHaveURL(/\/my\/login$/);
  });

  test("tenant sign-out also forgets the owner session", async ({ page, request }) => {
    const { token } = await createOwner(request, `session-t-${RUN_ID}`);
    await holdBoth(page, token, await tenantToken(request, token, "2"));

    await page.goto("/my");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/my\/login$/);
    expect(await stored(page)).toEqual({ owner: null, tenant: null });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test.describe("on an iPad in portrait", () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test("sign-out from the avatar menu forgets both", async ({ page, request }) => {
      const { token } = await createOwner(request, `session-i-${RUN_ID}`);
      await holdBoth(page, token, await tenantToken(request, token, "3"));

      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Account menu" }).tap();
      await page.getByRole("button", { name: "Sign out", exact: true }).tap();
      await expect(page).toHaveURL(/\/login$/);
      expect(await stored(page)).toEqual({ owner: null, tenant: null });
    });
  });
});
