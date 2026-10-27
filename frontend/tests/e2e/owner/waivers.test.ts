import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Waiving some of what is owed (owner, Oct 2026; migration 017). A quiet link under
 * what they owe; what they owe goes down on every screen, and nothing that
 * counts cash moves. For someone who already left owing, it comes off what
 * they still owe since the settlement.
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

/** A stay from the 1st two months ago at ₹9,000 a month, ₹9,000 paid: ₹18,000 owed. */
async function owingStay(request: APIRequestContext, suffix: string) {
  const { token } = await createOwner(request, `waive-${suffix}-${RUN_ID}`);
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `waive-${suffix}-${RUN_ID}`);
  const tenant = await createTenantViaApi(request, token, {
    name: `Varun ${suffix}`,
    phone: `91${RUN_ID.slice(-6)}${suffix.length}${suffix.length}`,
  });
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 900000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-2),
    },
  })).json();
  expect((await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
    headers: auth, data: { amount: 900000, payment_type: "cash", kind: "rent", payment_date: monthStart(-2) },
  })).ok()).toBeTruthy();
  return { token, auth, tenantId: tenant.id, stayId: stay.id };
}

async function summary(request: APIRequestContext, auth: Record<string, string>, tenantId: number) {
  return (await request.get(`${BASE}/api/tenants/${tenantId}/summary`, { headers: auth })).json();
}

test.describe("Waiving what is owed", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("comes off what they owe everywhere, never off what was collected, and can be taken back", async ({ page, request }) => {
    const s = await owingStay(request, "now");
    const before = await summary(request, s.auth, s.tenantId);
    expect(before.balance).toBe(1800000);
    const dashBefore = await (await request.get(`${BASE}/api/dashboard`, { headers: s.auth })).json();

    // More than they owe is refused, in words.
    const tooMuch = await request.post(`${BASE}/api/stays/${s.stayId}/waivers`, { headers: s.auth, data: { amount: 1900000 } });
    expect(tooMuch.status()).toBe(400);
    expect((await tooMuch.json()).error).toContain("₹18,000");

    await loginAs(page, s.token);
    await page.goto(`/tenants/${s.tenantId}`);
    await page.getByRole("button", { name: "Waive some of it…" }).tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("How much (₹)")).toHaveValue("18000");
    await dialog.getByLabel("How much (₹)").fill("4000");
    await dialog.getByLabel("Note (optional)").fill("Diwali");
    await expect(dialog).toContainText("Varun will owe ₹14,000 instead of ₹18,000.");
    await dialog.getByRole("button", { name: "Waive", exact: true }).tap();
    await expect(page.getByText("₹14,000 owed")).toBeVisible();

    // In the ledger, muted, with its note.
    await expect(page.getByRole("button", { name: /^Open ₹4,000 waived/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Diwali" })).toBeVisible();

    const after = await summary(request, s.auth, s.tenantId);
    expect(after.balance).toBe(1400000);
    expect(after.total_paid).toBe(900000); // not a payment
    // The oldest month is covered first: it was due on the 1st last month.
    expect(after.due_date).toBe(monthStart(-1));

    const board = await (await request.get(`${BASE}/api/payments/board`, { headers: s.auth })).json();
    expect(board.stays.find((r: { stay_id: number }) => r.stay_id === s.stayId).balance_paise).toBe(1400000);
    const dash = await (await request.get(`${BASE}/api/dashboard`, { headers: s.auth })).json();
    expect(dash.revenue.overdue_amount).toBe(dashBefore.revenue.overdue_amount - 400000);
    expect(dash.revenue.collected_this_month).toBe(dashBefore.revenue.collected_this_month);

    // Insights: the month it came off expects ₹4,000 less, and says so quietly.
    const ins = await (await request.get(`${BASE}/api/insights?months=3`, { headers: s.auth })).json();
    const month = ins.revenue.find((r: { month: string }) => r.month === monthStart(-1).slice(0, 7));
    expect(month.waived_paise).toBe(400000);
    expect(month.expected_paise).toBe(500000);
    expect(month.collected_paise).toBe(0);

    // On the Insights page: under that month's Billed, and in its lines,
    // where Collected doesn't count it.
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [y, m] = monthStart(-1).split("-").map(Number);
    await page.goto("/insights");
    await page.getByRole("button", { name: "Rent", exact: true }).tap();
    await expect(page.getByText("−₹4,000 waived")).toBeVisible();
    await page.getByRole("button", { name: `${months[m - 1]} ${y}`, exact: true }).tap();
    await expect(page.getByText("Waived", { exact: true })).toBeVisible();
    await expect(page.getByText("Collected: ₹0")).toBeVisible();

    // Take it back: they owe it again.
    await page.goto(`/tenants/${s.tenantId}`);
    await page.getByRole("button", { name: /^Open ₹4,000 waived/ }).tap();
    await page.getByRole("dialog").getByRole("button", { name: "Take back…" }).tap();
    await page.getByRole("dialog").filter({ hasText: "They'll owe it again." })
      .getByRole("button", { name: "Take back" }).tap();
    await expect(page.getByText("₹4,000 owed again")).toBeVisible();
    await expect(page.getByText("₹18,000 owed")).toBeVisible();
    expect((await summary(request, s.auth, s.tenantId)).balance).toBe(1800000);
  });

  test("for someone who left owing, it comes off what they still owe", async ({ page, request }) => {
    const s = await owingStay(request, "left");
    // Moved out today, settled with the server's figures: they owe the rest.
    const preview = await (await request.get(`${BASE}/api/stays/${s.stayId}/settlement-preview`, { headers: s.auth })).json();
    expect((await request.post(`${BASE}/api/stays/${s.stayId}/settlement`, {
      headers: s.auth, data: { refund_paise: preview.refund_paise, adjustments: [] },
    })).ok()).toBeTruthy();
    const owed = -preview.refund_paise;
    expect(owed).toBeGreaterThan(0);

    await loginAs(page, s.token);
    await page.goto(`/tenants/${s.tenantId}`);
    await page.getByRole("button", { name: "Waive some of it…" }).tap();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Waive", exact: true }).tap(); // all of it, as filled in
    await expect(page.getByRole("button", { name: /^Open ₹[\d,]+ waived/ })).toBeVisible();

    expect((await summary(request, s.auth, s.tenantId)).balance).toBe(0);
    const board = await (await request.get(`${BASE}/api/payments/board`, { headers: s.auth })).json();
    expect(board.moved_out.find((r: { stay_id: number }) => r.stay_id === s.stayId)).toBeUndefined();
    await expect(page.getByRole("button", { name: "Waive some of it…" })).toHaveCount(0);
  });

  test("what a settlement was worked out from waits for the settlement to be undone", async ({ page, request }) => {
    const s = await owingStay(request, "held");
    const lg = await (await request.post(`${BASE}/api/stays/${s.stayId}/waivers`, {
      headers: s.auth, data: { amount: 300000 },
    })).json();
    const preview = await (await request.get(`${BASE}/api/stays/${s.stayId}/settlement-preview`, { headers: s.auth })).json();
    // The settlement counts it: ₹3,000 less in dues than without.
    expect(preview.dues_paise).toBe(preview.cycles_billed * 900000 - 900000 - 300000);
    expect((await request.post(`${BASE}/api/stays/${s.stayId}/settlement`, {
      headers: s.auth, data: { refund_paise: preview.refund_paise, adjustments: [] },
    })).ok()).toBeTruthy();

    const held = await request.delete(`${BASE}/api/waivers/${lg.id}`, { headers: s.auth });
    expect(held.status()).toBe(409);
    expect((await held.json()).error).toContain("Undo the settlement");

    await loginAs(page, s.token);
    await page.goto(`/tenants/${s.tenantId}`);
    await page.getByRole("button", { name: /^Open ₹3,000 waived/ }).tap();
    await expect(page.getByRole("dialog")).toContainText("undo the settlement first");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Take back…" })).toHaveCount(0);
  });
});
