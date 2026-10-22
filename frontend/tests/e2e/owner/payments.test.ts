import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `pay-${Date.now()}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function phone(): string {
  return `98${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function day(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function daysFromToday(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
}
/** Yesterday as the browser sees it — the page's "Yesterday" is local. */
function localYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Three tenants in one room, one per list the screen has:
 *
 *   Behind  moved in 40 days ago, paid one month: Overdue.
 *   Soon    moved in a month less three days ago, paid that month by UPI:
 *           paid up now, next rent due in three days — Due this week.
 *   Ahead   moved in 10 days ago, paid three months: on neither list, found
 *           by searching.
 */
async function seed(request: APIRequestContext, runId: string) {
  const { token } = await createOwner(request, runId);
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, runId);
  const beds = [bedId];
  for (const name of ["Bed B", "Bed C"]) {
    const res = await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name } });
    beds.push((await res.json()).id);
  }
  const now = new Date();
  const soonStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, now.getUTCDate() + 3));
  const ids: Record<string, { tenant: number; stay: number }> = {};
  for (const [i, [name, start, rent, months, type]] of ([
    ["Behind Tenant", daysFromToday(-40), 6500, 1, "cash"],
    ["Soon Tenant", soonStart, 5000, 1, "online"],
    ["Ahead Tenant", daysFromToday(-10), 8500, 3, "cash"],
  ] as const).entries()) {
    const tenant = await createTenantViaApi(request, token, { name: `${name} ${runId}`, phone: phone() });
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: beds[i], rent_amount: rent * 100, deposit_amount: 0,
        rent_cycle: "monthly", start_date: iso(start),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const stay = await res.json();
    const pay = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: rent * 100 * months, payment_type: type, payment_date: iso(start) },
    });
    expect(pay.ok(), await pay.text()).toBeTruthy();
    ids[name] = { tenant: tenant.id, stay: stay.id };
  }
  const board = await (await request.get(`${BASE}/api/payments/board`, { headers: auth })).json();
  const due: Record<string, { due_date: string; due_state: string; last_payment_type?: string }> = {};
  for (const r of board.stays) due[r.tenant_name.replace(` ${runId}`, "")] = r;
  return { token, ids, due, board };
}

test.describe("Payments", () => {
  test("lists who is overdue and who is due this week, and records one in a few taps", async ({ page, request }) => {
    const runId = `${RUN_ID}-lists`;
    const { token, ids, due, board } = await seed(request, runId);
    expect(due["Behind Tenant"].due_state).toBe("overdue");
    expect(due["Soon Tenant"].due_state).toBe("upcoming");
    expect(due["Ahead Tenant"].due_state).toBe("paid_ahead");
    // Soonest due first: the oldest arrears lead.
    expect(board.stays.map((r: { tenant_name: string }) => r.tenant_name)[0]).toBe(`Behind Tenant ${runId}`);

    await loginAs(page, token);
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByText("1 overdue · 1 due this week")).toBeVisible();

    const overdue = page.locator("section").filter({ has: page.getByRole("heading", { name: "Overdue" }) });
    const thisWeek = page.locator("section").filter({ has: page.getByRole("heading", { name: "Due this week" }) });
    await expect(overdue).toContainText(`Behind Tenant ${runId}`);
    await expect(overdue).toContainText(`Overdue since ${day(due["Behind Tenant"].due_date)}`);
    await expect(thisWeek).toContainText(`Soon Tenant ${runId}`);
    await expect(thisWeek).toContainText(day(due["Soon Tenant"].due_date));
    // Paid three months ahead: nothing to act on, so on neither list. (Its
    // payment, entered today, is under "Recorded this week".)
    await expect(overdue).not.toContainText(`Ahead Tenant ${runId}`);
    await expect(thisWeek).not.toContainText(`Ahead Tenant ${runId}`);
    // Nobody is chased for rent that is not due yet.
    await expect(thisWeek.getByRole("link", { name: "Nudge" })).toHaveCount(0);

    // Everything prefilled: the rent coming due, the way they paid last time.
    await thisWeek.getByRole("button", { name: "Record", exact: true }).click();
    await expect(thisWeek.getByLabel("Amount (₹)")).toHaveValue("5000");
    await expect(thisWeek.getByRole("button", { name: "UPI" })).toHaveAttribute("aria-pressed", "true");
    await expect(thisWeek.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    // Entered a day late, from memory.
    await thisWeek.getByRole("button", { name: "Yesterday" }).click();
    await thisWeek.getByRole("button", { name: "Save ₹5,000" }).click();

    await expect(page.getByText("Recorded ₹5,000 from Soon")).toBeVisible();
    const recorded = page.getByRole("region", { name: "Recorded this week" });
    await expect(recorded).toContainText(`Soon Tenant ${runId}`);
    await expect(recorded).toContainText(`UPI · paid ${day(localYesterday())}`);
    await expect(page.getByRole("heading", { name: "Due this week" })).toHaveCount(0);

    const auth = { Authorization: `Bearer ${token}` };
    const payments = await (await request.get(`${BASE}/api/stays/${ids["Soon Tenant"].stay}/payments`, { headers: auth })).json();
    const latest = payments.find((p: { amount: number; payment_date: string }) => p.amount === 500000 && p.payment_date.startsWith(localYesterday()));
    expect(latest, JSON.stringify(payments)).toBeTruthy();
    expect(latest.payment_type).toBe("online");
  });

  test("anyone not on the lists is a search away", async ({ page, request }) => {
    const runId = `${RUN_ID}-search`;
    const { token } = await seed(request, runId);
    await loginAs(page, token);
    await page.goto("/payments");

    await page.getByLabel("Who paid? Search by name or room").fill("ahead");
    await expect(page.getByText("1 match")).toBeVisible();
    await expect(page.getByText(`Ahead Tenant ${runId}`)).toBeVisible();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByLabel("Amount (₹)")).toHaveValue("8500");
    await page.getByRole("button", { name: "Cash" }).click();
    await page.getByRole("button", { name: "+ Note" }).click();
    await page.getByLabel("Note").fill("Paid early");
    await page.getByRole("button", { name: "Save ₹8,500" }).click();
    await expect(page.getByText("Recorded ₹8,500 from Ahead")).toBeVisible();
    // The search clears, so the next one starts from the lists.
    await expect(page.getByLabel("Who paid? Search by name or room")).toHaveValue("");

    // By room too.
    await page.getByLabel("Who paid? Search by name or room").fill("bed c");
    await expect(page.getByText("1 match")).toBeVisible();
  });

  test("the old address, the dashboard and portal proofs all lead here", async ({ page, request }) => {
    const runId = `${RUN_ID}-links`;
    const { token, ids } = await seed(request, runId);
    const auth = { Authorization: `Bearer ${token}` };

    // A proof sent from the tenant portal, waiting for approval.
    await request.put(`${BASE}/api/tenants/${ids["Behind Tenant"].tenant}/portal-password`, {
      headers: auth, data: { password: "tenant1234" },
    });
    const behind = await (await request.get(`${BASE}/api/tenants/${ids["Behind Tenant"].tenant}`, { headers: auth })).json();
    const tenantToken = (await (await request.post(`${BASE}/tenant-auth/login`, {
      data: { phone: behind.phone, password: "tenant1234" },
    })).json()).token;
    const proof = await request.post(`${BASE}/tenant/stays/${ids["Behind Tenant"].stay}/payments`, {
      headers: { Authorization: `Bearer ${tenantToken}` }, data: { amount: 100000, notes: "UPI" },
    });
    expect(proof.ok(), await proof.text()).toBeTruthy();

    await loginAs(page, token);
    await page.goto("/collections");
    await expect(page).toHaveURL(/\/payments$/);

    await page.getByRole("link", { name: /1 payment sent from the tenant portal to approve/ }).click();
    await expect(page).toHaveURL(/\/pending\?tab=payments$/);
    await expect(page.getByText(`Behind Tenant ${runId}`)).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: /tenant due to pay this week/ }).click();
    await expect(page).toHaveURL(/\/payments$/);
  });
});
