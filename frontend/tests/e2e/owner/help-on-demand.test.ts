import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `help-${Date.now()}`;

/**
 * Two things the owner read past every day (27 Oct 2026). The explanations
 * in Record notice are right the first time and clutter after, so they wait
 * behind an ⓘ. Delete tenant keeps one short line instead, by the owner's
 * choice: that warning belongs before the button. And the grid's bed panel said
 * "/mo" for every rent, so a guest's ₹500 a night read as monthly.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

test("the notice explanations wait behind an ⓘ; delete keeps a short warning", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-a`);
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-a`);
  const tenant = await createTenantViaApi(request, token, { name: "Help Wanted", phone: "9812600001" });
  const res = await request.post(`${BASE}/api/stays`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: utcDay(-10) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await loginAs(page, token);
  await page.goto(`/tenants/${tenant.id}`);

  // Delete keeps one short warning in view, because it has to be read before
  // the button rather than after an ⓘ.
  await expect(page.getByRole("heading", { name: "Delete tenant" })).toBeVisible();
  await expect(page.getByText("Only for a test entry or a duplicate.")).toBeVisible();
  await expect(page.getByRole("button", { name: "About deleting a tenant" })).toHaveCount(0);

  await page.getByRole("button", { name: "Record notice" }).tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Help Wanted is planning to leave.");
  await expect(dialog.getByText(/rent keeps accruing/)).toHaveCount(0);
  await expect(dialog.getByText(/turns orange/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "About notices" }).tap();
  await expect(dialog.getByText(/rent keeps accruing/)).toBeVisible();
  await expect(dialog.getByText(/turns orange/)).toBeVisible();
});

test("the bed panel says what a rent is for", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-b`);
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-b`);
  const auth = { Authorization: `Bearer ${token}` };
  const bed2 = await (await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name: "Bed 2" } })).json();
  for (const [name, phone, bed, rent, cycle] of [
    ["Night Guest", "9812600002", bedId, 50000, "daily"],
    ["Month Tenant", "9812600003", bed2.id, 800000, "monthly"],
  ] as const) {
    const t = await createTenantViaApi(request, token, { name, phone });
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: t.id, bed_id: bed, rent_amount: rent, deposit_amount: 0, rent_cycle: cycle, start_date: utcDay(0) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  await loginAs(page, token);
  await page.goto(`/sites/${siteId}/grid`);

  await page.getByTitle(/^Night Guest/).tap();
  await expect(page.getByRole("dialog")).toContainText("Rent ₹500 a night");
  await expect(page.getByRole("dialog")).not.toContainText("/mo");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByTitle(/^Month Tenant/).tap();
  await expect(page.getByRole("dialog")).toContainText("Rent ₹8,000 a month");
});
