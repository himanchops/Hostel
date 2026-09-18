import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Settling a tenant who left owing money took them off Collections and out of
 * the dashboard's Overdue — and the tenant who has already left is the one most
 * likely not to pay (UX audit M12). They now stay, under "Moved out — still
 * owes", until what they owe is paid.
 *
 * Kiran: ₹5,000/mo from the 1st of two months ago (three cycles, ₹15,000),
 * paid a ₹3,000 deposit and no rent. Settled today: ₹3,000 held − ₹15,000 dues
 * = ₹12,000 short. Then pays ₹5,000, then the last ₹7,000.
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

test.describe("A tenant who moved out still owing", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("stays on Collections and in Overdue until they have paid", async ({ page, request }) => {
    const { token } = await createOwner(request, `moved-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `moved-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Kiran ${RUN_ID}`, phone: `96${RUN_ID.slice(-8)}` });
    const stay = await post(request, token, "/api/stays", {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 300000,
      rent_cycle: "monthly", start_date: monthStart(-2),
    });
    await post(request, token, `/api/stays/${stay.id}/payments`, { amount: 300000, kind: "deposit", payment_type: "cash" });

    const preview = await (await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, { headers: auth })).json();
    expect(preview.refund_paise).toBe(-1200000);
    await post(request, token, `/api/stays/${stay.id}/settlement`, { refund_paise: preview.refund_paise, adjustments: [] });

    // ── Still on the chase list, in its own group, in the right words ──
    await loginAs(page, token);
    await page.goto("/collections");
    const group = page.getByRole("region", { name: "Moved out — still owes" });
    await expect(group).toBeVisible();
    await expect(group).toContainText("₹12,000 across 1 tenant");
    const card = group.locator("div").filter({ hasText: `Kiran ${RUN_ID}` }).first();
    await expect(card).toContainText("was in Room 1 · Bed A");
    await expect(card).toContainText("settled today");
    await expect(card).toContainText("₹12,000");

    // The nudge is about what is outstanding, not rent on a room they left.
    const nudge = await group.getByRole("link", { name: /Nudge/ }).getAttribute("href");
    expect(decodeURIComponent(nudge!)).toContain("₹12,000 is still outstanding from when you moved out");

    // ── The dashboard counts it, and says where it comes from ──
    await page.goto("/dashboard");
    await expect(page.getByText("incl. ₹12,000 from tenants who moved out")).toBeVisible();
    const dash = await (await request.get(`${BASE}/api/dashboard`, { headers: auth })).json();
    expect(dash.revenue.moved_out_owed).toBe(1200000);
    expect(dash.revenue.overdue_amount).toBe(1200000);

    // ── A part payment goes against it, on every screen ──
    await page.goto("/collections");
    await group.getByRole("button", { name: "Record payment" }).tap();
    await group.getByLabel("Amount (₹)").fill("5000");
    await group.getByRole("button", { name: "Save payment" }).tap();
    await expect(page.getByText(`Recorded ₹5,000 from Kiran`)).toBeVisible();
    await expect(group).toContainText("₹7,000 across 1 tenant");

    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(summary.balance).toBe(700000);

    // ── Paid off: gone ──
    await post(request, token, `/api/stays/${stay.id}/payments`, { amount: 700000, payment_type: "online" });
    await page.reload();
    await expect(page.getByText("Everyone is paid up 🎉")).toBeVisible();
    const after = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(after.balance).toBe(0);
  });

  test("a settlement that paid the tenant back never shows as owed", async ({ page, request }) => {
    const { token } = await createOwner(request, `moved-b-${RUN_ID}`);
    const { bedId } = await createSiteRoomBed(request, token, `moved-b-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Neha ${RUN_ID}`, phone: `97${RUN_ID.slice(-8)}` });
    const stay = await post(request, token, "/api/stays", {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 1000000,
      rent_cycle: "monthly", start_date: monthStart(0),
    });
    await post(request, token, `/api/stays/${stay.id}/payments`, { amount: 1000000, kind: "deposit" });
    await post(request, token, `/api/stays/${stay.id}/payments`, { amount: 500000 });
    const preview = await (await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(preview.refund_paise).toBe(1000000);
    await post(request, token, `/api/stays/${stay.id}/settlement`, { refund_paise: preview.refund_paise, adjustments: [] });

    await loginAs(page, token);
    await page.goto("/collections");
    await expect(page.getByText("Everyone is paid up 🎉")).toBeVisible();
    await expect(page.getByText("Moved out — still owes")).toHaveCount(0);
  });
});
