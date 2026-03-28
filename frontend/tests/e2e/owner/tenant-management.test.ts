import { test, expect } from "@playwright/test";
import { createOwner, createTenantViaApi } from "../helpers/api";

/**
 * Tenant management tests.
 *
 * Covers:
 *  - Owner creates a tenant via the UI form (the bug: "failed to create tenant")
 *  - Owner creates a tenant via the API directly (confirms whether it's UI or backend)
 *  - Created tenant appears in the tenant list
 */

const RUN_ID = String(Date.now());

test.describe("Tenant management", () => {
  let ownerToken: string;
  let ownerEmail: string;

  test.beforeAll(async ({ request }) => {
    const { token, owner } = await createOwner(request, RUN_ID);
    ownerToken = token;
    ownerEmail = owner.email;
  });

  // ── API-level test (no browser) ────────────────────────────────────────────

  test("POST /api/tenants returns 201 with tenant data", async ({ request }) => {
    const tenant = await createTenantViaApi(request, ownerToken, {
      name: `API Tenant ${RUN_ID}`,
      phone: `9${RUN_ID.slice(-9)}`,
      email: `tenant-api-${RUN_ID}@test.local`,
    });

    expect(tenant.id).toBeTruthy();
    expect(tenant.name).toBe(`API Tenant ${RUN_ID}`);
    expect(tenant.is_approved).toBe(true);
  });

  test("POST /api/tenants works without optional email", async ({ request }) => {
    const tenant = await createTenantViaApi(request, ownerToken, {
      name: `No Email Tenant ${RUN_ID}`,
      phone: `8${RUN_ID.slice(-9)}`,
    });

    expect(tenant.id).toBeTruthy();
    expect(tenant.name).toBe(`No Email Tenant ${RUN_ID}`);
  });

  // ── UI-level test (browser) ────────────────────────────────────────────────

  test("owner can create a tenant via the UI form", async ({ page, request }) => {
    // Log in via localStorage injection (faster than UI login)
    const loginRes = await request.post("http://localhost:8080/auth/login", {
      data: { email: ownerEmail, password: "testpassword123" },
    });
    const { token } = await loginRes.json();

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("hostel_token", t), token);
    await page.goto("/tenants");

    // Open the create form
    await page.getByRole("button", { name: "+ Add tenant" }).click();
    await expect(page.getByText("New tenant")).toBeVisible();

    // Fill the form
    const uiName = `UI Tenant ${RUN_ID}`;
    const uiPhone = `7${RUN_ID.slice(-9)}`;
    await page.getByPlaceholder("Full name *").fill(uiName);
    await page.getByPlaceholder("Phone *").fill(uiPhone);
    await page.getByPlaceholder("Email (optional)").fill(`ui-tenant-${RUN_ID}@test.local`);

    // Submit
    await page.getByRole("button", { name: "Create" }).click();

    // Should NOT show an error
    await expect(page.locator(".bg-red-50")).not.toBeVisible();

    // Tenant should appear in the list
    await expect(page.getByText(uiName)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(uiPhone)).toBeVisible();
  });

  test("create form shows validation error for missing name", async ({ page, request }) => {
    const loginRes = await request.post("http://localhost:8080/auth/login", {
      data: { email: ownerEmail, password: "testpassword123" },
    });
    const { token } = await loginRes.json();

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("hostel_token", t), token);
    await page.goto("/tenants");

    await page.getByRole("button", { name: "+ Add tenant" }).click();
    await page.getByPlaceholder("Phone *").fill("9999999999");
    await page.getByRole("button", { name: "Create" }).click();

    // Browser native required validation prevents submission — form stays open
    await expect(page.getByText("New tenant")).toBeVisible();
  });
});
