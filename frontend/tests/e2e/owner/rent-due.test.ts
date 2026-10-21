import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `due-${Date.now()}`;
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

/**
 * Three tenants in one room, one per state a tile can be in. The exact dates
 * are the backend's business (due_test.go pins them for 31sts, rent changes
 * and paid-ahead); this checks that what the API says is what the owner sees.
 *
 *   Behind  moved in 40 days ago, paid one month: overdue since the second.
 *   Soon    moves in three days from now, nothing paid: due on arrival.
 *   Ahead   moved in 10 days ago, paid three months: nothing due for a while.
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
  const ids: Record<string, number> = {};
  for (const [i, [name, startIn, rent, months]] of ([
    ["Behind Tenant", -40, 6500, 1],
    ["Soon Tenant", 3, 5000, 0],
    ["Ahead Tenant", -10, 8500, 3],
  ] as const).entries()) {
    const tenant = await createTenantViaApi(request, token, { name, phone: phone() });
    ids[name] = tenant.id;
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: beds[i], rent_amount: rent * 100, deposit_amount: 0,
        rent_cycle: "monthly", start_date: iso(daysFromToday(startIn)),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const stay = await res.json();
    if (months > 0) {
      const pay = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
        headers: auth,
        data: { amount: rent * 100 * months, payment_type: "cash", payment_date: iso(daysFromToday(Math.min(startIn, 0))) },
      });
      expect(pay.ok(), await pay.text()).toBeTruthy();
    }
  }
  const grid = await (await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth })).json();
  const due: Record<string, { due_date: string; due_state: string }> = {};
  for (const b of grid[0].beds) if (b.tenant) due[b.tenant.name] = b;
  return { token, siteId, ids, due };
}

test.describe("When rent is due", () => {
  test("tiles date only what needs acting on; the panel says it in one line", async ({ page, request }) => {
    const { token, siteId, due } = await seed(request, `${RUN_ID}-grid`);
    expect(due["Behind Tenant"].due_state).toBe("overdue");
    expect(due["Soon Tenant"].due_state).toBe("upcoming");
    expect(due["Ahead Tenant"].due_state).toBe("paid_ahead");

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);

    const tile = (name: string) => page.getByTitle(new RegExp(`^${name} —`));
    // Behind: the red tile says since when.
    await expect(tile("Behind Tenant")).toContainText(`due ${day(due["Behind Tenant"].due_date)}`);
    // Due within the week: a date, so it can be collected on time.
    await expect(tile("Soon Tenant")).toContainText(`due ${day(due["Soon Tenant"].due_date)}`);
    // Paid ahead: nothing to act on, nothing on the tile.
    await expect(tile("Ahead Tenant")).not.toContainText("due");

    await tile("Behind Tenant").click();
    await expect(page.getByText(`Overdue since ${day(due["Behind Tenant"].due_date)}`)).toBeVisible();
    await page.keyboard.press("Escape");

    await tile("Ahead Tenant").click();
    await expect(page.getByText(`Paid up to ${day(due["Ahead Tenant"].due_date)}`)).toBeVisible();
  });

  test("the tenant page says when the next rent is due", async ({ page, request }) => {
    const { token, ids, due } = await seed(request, `${RUN_ID}-page`);
    await loginAs(page, token);

    await page.goto(`/tenants/${ids["Soon Tenant"]}`);
    await expect(page.getByText(`Next rent ₹5,000 due ${day(due["Soon Tenant"].due_date)}`)).toBeVisible();

    await page.goto(`/tenants/${ids["Behind Tenant"]}`);
    await expect(page.getByText(`Overdue since ${day(due["Behind Tenant"].due_date)}`)).toBeVisible();
  });
});
