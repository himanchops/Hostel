import { test, expect } from "@playwright/test";
import { createOwner, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `portal-${Date.now()}`;

function phone() {
  return `98${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * The gap: portal login requires a password hash, and only the public
 * registration form ever wrote one. Every tenant an owner typed in by hand was
 * locked out of /my permanently — which is what made a portal-exclusive
 * capability unreachable for them rather than merely inconvenient.
 */
test.describe("Portal access for an owner-created tenant", () => {
  test("starts with no login, and the owner can create one", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-a`);
    const tenantPhone = phone();
    const tenant = await createTenantViaApi(request, token, {
      name: "Hand Typed",
      phone: tenantPhone,
    });

    // The API says so before any pixel does.
    const before = await request.get(`${BASE}/api/tenants/${tenant.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await before.json()).has_portal_login).toBe(false);

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    await expect(page.getByText("No login", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create login" }).click();

    await page.getByLabel("New password").fill("corridor42");
    await page.getByLabel("Confirm password").fill("corridor42");
    await page.getByRole("button", { name: "Create login" }).last().click();

    // The card flips, because the server told it the tenant changed.
    await expect(page.getByText("Can sign in", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset password" })).toBeVisible();

    // And the password actually works, which is the only thing that matters.
    const login = await request.post(`${BASE}/tenant-auth/login`, {
      data: { phone: tenantPhone, password: "corridor42" },
    });
    expect(login.ok()).toBeTruthy();
    expect((await login.json()).token).toBeTruthy();
  });

  test("mismatched confirmation never reaches the server", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-b`);
    const tenantPhone = phone();
    const tenant = await createTenantViaApi(request, token, {
      name: "Typo Prone",
      phone: tenantPhone,
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Create login" }).click();

    await page.getByLabel("New password").fill("corridor42");
    await page.getByLabel("Confirm password").fill("corridor43");
    await page.getByRole("button", { name: "Create login" }).last().click();

    await expect(page.getByText("The two passwords do not match.")).toBeVisible();

    // Neither password took effect — the tenant is still locked out.
    const after = await request.get(`${BASE}/api/tenants/${tenant.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await after.json()).has_portal_login).toBe(false);
  });

  test("the server's own minimum is what the owner is shown", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-c`);
    const tenant = await createTenantViaApi(request, token, {
      name: "Short Password",
      phone: phone(),
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Create login" }).click();

    await page.getByLabel("New password").fill("abc12");
    await page.getByLabel("Confirm password").fill("abc12");
    await page.getByRole("button", { name: "Create login" }).last().click();

    // Not a generic "failed to save" — the backend's wording reaches the owner.
    await expect(page.getByText("password must be at least 6 characters")).toBeVisible();
  });

  test("another owner cannot set it", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-d`);
    const { token: intruder } = await createOwner(request, `${RUN_ID}-e`);
    const tenant = await createTenantViaApi(request, token, {
      name: "Not Yours",
      phone: phone(),
    });

    const res = await request.put(`${BASE}/api/tenants/${tenant.id}/portal-password`, {
      headers: { Authorization: `Bearer ${intruder}` },
      data: { password: "hijacked1" },
    });
    expect(res.status()).toBe(404);
  });
});
