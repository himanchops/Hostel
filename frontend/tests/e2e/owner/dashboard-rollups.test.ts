import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The dashboard's money tiles against the screens they summarise (UX audit M3,
 * M4). The per-tenant engine was right; the roll-ups each counted differently:
 *
 *   - "Collected this month" bounded the month but never capped it at today,
 *     so payments dated later in the month counted (₹69,900 vs Insights'
 *     ₹53,600 on 9 Sep).
 *   - "Overdue" only summed tenants with a bed, so an approved tenant awaiting
 *     one owed money in Collections and nothing on the tile (₹40,400 vs
 *     ₹47,900) — on a tile whose own link says "chase it from Collections".
 *
 * Dates are UTC because the backend's "today" is UTC midnight.
 */
function utcDay(offsetDays: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offsetDays))
    .toISOString().slice(0, 10);
}

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  return request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
}

test.describe("Dashboard roll-ups", () => {
  test("collected stops at today, overdue counts the tenant with no bed, far-future payments are refused", async ({ page, request }) => {
    const { token } = await createOwner(request, `rollup-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-rollup`);

    const inBed = await createTenantViaApi(request, token, { name: `In Bed ${RUN_ID}`, phone: `93${RUN_ID.slice(-8)}` });
    const noBed = await createTenantViaApi(request, token, { name: `No Bed ${RUN_ID}`, phone: `92${RUN_ID.slice(-8)}` });

    // Both from the 1st of last month, so exactly two cycles are billed each
    // whatever day this runs: ₹5,000 × 2 in the bed, ₹7,500 × 2 without one.
    const bedStay = await (await post(request, token, "/api/stays", {
      tenant_id: inBed.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-1),
    })).json();
    const noBedStay = await (await post(request, token, "/api/stays", {
      tenant_id: noBed.id, rent_amount: 750000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-1),
    })).json();
    expect(noBedStay.bed_id).toBeNull();

    // ₹7,500 from the bed-less tenant today.
    const todays = await post(request, token, `/api/stays/${noBedStay.id}/payments`,
      { amount: 750000, payment_type: "online", payment_date: utcDay(0) });
    expect(todays.status()).toBe(201);

    // ₹1,000 dated tomorrow is allowed — just after midnight in India the
    // owner's today is the server's tomorrow — but it has not arrived yet as
    // far as "collected this month" is concerned.
    const tomorrows = await post(request, token, `/api/stays/${bedStay.id}/payments`,
      { amount: 100000, payment_type: "cash", payment_date: utcDay(1) });
    expect(tomorrows.status()).toBe(201);

    // Anything further out is a typo and is refused.
    const farOut = await post(request, token, `/api/stays/${bedStay.id}/payments`,
      { amount: 850000, payment_type: "cash", payment_date: utcDay(5) });
    expect(farOut.status()).toBe(400);
    expect((await farOut.json()).error).toContain("in the future");

    const dashboard = await (await request.get(`${BASE}/api/dashboard`, { headers: auth })).json();
    const rows: { balance_paise: number }[] =
      await (await request.get(`${BASE}/api/collections`, { headers: auth })).json();
    const owedInCollections = rows.reduce((sum, r) => sum + r.balance_paise, 0);

    // M4: (₹10,000 − ₹1,000) in the bed + (₹15,000 − ₹7,500) without one.
    expect(owedInCollections).toBe(1650000);
    // Before the fix this read ₹9,000: the bed-less tenant was not counted.
    expect(dashboard.revenue.overdue_amount).toBe(owedInCollections);

    // M3: today's ₹7,500 counts; tomorrow's ₹1,000 does not. (On the last day
    // of a month the month bound excludes it too, so that day proves less.)
    expect(dashboard.revenue.collected_this_month).toBe(750000);

    // And the tiles say the same, on an iPad.
    await loginAs(page, token);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/dashboard");
    await expect(
      page.locator("a, div").filter({ hasText: /^Collected This Month/ }).filter({ hasText: "₹7,500" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("a, div").filter({ hasText: /^Overdue/ }).filter({ hasText: "₹16,500" }).first(),
    ).toBeVisible();
  });
});
