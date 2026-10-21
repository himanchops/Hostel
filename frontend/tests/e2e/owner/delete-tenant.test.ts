import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The owner asked how to delete a tenant they no longer wanted — two test
 * entries on the live account — and there was no way at all: the backend had
 * no delete for an approved tenant and no screen offered one.
 */
test.describe("Deleting a tenant", () => {
  test("removes them with their stay and payments, and frees the bed", async ({ page, request }) => {
    const { token } = await createOwner(request, `del-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, bedId } = await createSiteRoomBed(request, token, `del-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Test Entry ${RUN_ID}`, phone: "9000000001" });

    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: "2026-09-06" },
    })).json();
    await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 250000, payment_type: "cash", payment_date: "2026-09-08" },
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Delete tenant…" }).click();

    // The dialog states the cost before it offers the button.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Delete Test Entry ${RUN_ID}?`);
    await expect(dialog).toContainText("1 stay, 1 payment (₹2,500 received)");
    await expect(dialog).toContainText("Their bed becomes vacant.");
    await expect(dialog).toContainText("cannot be undone");

    // Cancel first: nothing happens.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await request.get(`${BASE}/api/tenants/${tenant.id}`, { headers: auth })).status()).toBe(200);

    await page.getByRole("button", { name: "Delete tenant…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete tenant" }).click();

    await expect(page).toHaveURL(/\/tenants$/);
    await expect(page.getByText(`Test Entry ${RUN_ID} deleted`)).toBeVisible();
    await expect(page.getByText(`Test Entry ${RUN_ID}`, { exact: true })).toHaveCount(0);

    // Gone with everything it owned, and the bed is free again.
    expect((await request.get(`${BASE}/api/tenants/${tenant.id}`, { headers: auth })).status()).toBe(404);
    expect((await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth })).status()).toBe(404);
    const grid = await (await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth })).json();
    const bed = JSON.stringify(grid);
    expect(bed).not.toContain(`Test Entry ${RUN_ID}`);
  });

  test("another owner cannot delete someone else's tenant", async ({ request }) => {
    const a = await createOwner(request, `del-a-${RUN_ID}`);
    const b = await createOwner(request, `del-b-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, a.token, { name: `Kept ${RUN_ID}`, phone: "9000000002" });

    const res = await request.delete(`${BASE}/api/tenants/${tenant.id}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(res.status()).toBe(404);
    const still = await request.get(`${BASE}/api/tenants/${tenant.id}`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    expect(still.status()).toBe(200);
  });
});
