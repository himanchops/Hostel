import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `moveout-${Date.now()}`;
const RENT = 650000; // ₹6,500
const DEPOSIT = 1000000; // ₹10,000

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}
function phone(): string {
  return `97${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * One tenant, rent ₹6,500 and a ₹10,000 deposit, whose current rent month
 * began ten days ago: three months billed by today.
 *
 *   notice  "in time"  told three days before this rent month began
 *           "late"     told today, ten days into their last month
 *           null       never told you
 *   months  rent months paid (3 = square, 5 = two months ahead)
 */
async function seed(
  request: APIRequestContext,
  runId: string,
  opts: { notice: "in time" | "late" | null; months: number },
) {
  const { token } = await createOwner(request, runId);
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, bedId } = await createSiteRoomBed(request, token, runId);
  const now = new Date();
  const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
  const start = utc(y, m - 2, d - 10);
  const cycleBegan = utc(y, m, d - 10);
  const name = `Ravi ${runId}`;
  const tenant = await createTenantViaApi(request, token, { name, phone: phone() });
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: RENT, deposit_amount: DEPOSIT,
      rent_cycle: "monthly", start_date: iso(start),
    },
  })).json();
  const pay = (data: object) =>
    request.post(`${BASE}/api/stays/${stay.id}/payments`, { headers: auth, data }).then((r) => {
      if (!r.ok()) throw new Error("payment failed");
    });
  await pay({ amount: DEPOSIT, kind: "deposit", payment_type: "cash", payment_date: iso(start) });
  await pay({ amount: RENT * opts.months, payment_type: "online", payment_date: iso(start) });
  if (opts.notice) {
    const told = opts.notice === "in time" ? utc(y, m, d - 13) : utc(y, m, d);
    await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { notice_date: iso(told) } });
  }
  return { token, auth, siteId, tenant, stay, name, cycleBegan };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

test.describe("Moving out", () => {
  // The owner's iPad, upright, with touch.
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("notice in time: the deposit goes back in full, paid back by cash", async ({ page, request }) => {
    const { token, auth, tenant } = await seed(request, `${RUN_ID}-ontime`, { notice: "in time", months: 3 });
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/Gave notice .*, in time\./)).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Give it back" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
    await expect(sheet.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Move out · hand back ₹10,000" }).tap();
    await expect(page.getByText("Ravi moved out · ₹10,000 handed back")).toBeVisible();

    const [s] = await (await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth })).json();
    expect(s.refund_paise).toBe(DEPOSIT);
    expect(s.adjustments).toEqual([]);
    expect(s.refund_method).toBe("cash");
  });

  test("no notice: the deposit is kept by default, and the owner can still give it back", async ({ page, request }) => {
    const { token, auth, tenant } = await seed(request, `${RUN_ID}-none`, { notice: null, months: 3 });
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("No notice given, so the deposit is kept by default.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Keep it" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByText("Deposit kept: no notice")).toBeVisible();
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("0");

    // The owner's call: they give back ₹4,000 of it anyway, typed over the 0.
    await sheet.getByLabel("Hand back (₹)").fill("4000");
    await expect(sheet.getByText("Changed by you from ₹0.")).toBeVisible();
    await sheet.getByRole("button", { name: "UPI" }).tap();
    await sheet.getByRole("button", { name: "Move out · hand back ₹4,000" }).tap();
    await expect(page.getByText("Ravi moved out · ₹4,000 handed back")).toBeVisible();

    // On the record as a sum that adds up, saying a person changed it.
    const [s] = await (await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth })).json();
    expect(s.refund_paise).toBe(400000);
    expect(s.refund_method).toBe("online");
    expect(s.adjustments).toEqual([
      { label: "Deposit kept: no notice", amount_paise: -DEPOSIT },
      { label: "Changed by you", amount_paise: 400000 },
    ]);
  });

  test("a notice nobody wrote down can be recorded from the sheet", async ({ page, request }) => {
    const { token, auth, tenant, stay } = await seed(request, `${RUN_ID}-told`, { notice: null, months: 3 });
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "They gave notice" }).tap();
    await expect(sheet.getByRole("button", { name: "Give it back" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
    await sheet.getByRole("button", { name: "Move out · hand back ₹10,000" }).tap();
    await expect(page.getByText("Ravi moved out · ₹10,000 handed back")).toBeVisible();

    const saved = await (await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth })).json();
    expect(saved.notice_date).toBeTruthy();
  });

  test("late notice: said plainly, deposit still back by default", async ({ page, request }) => {
    const { token, tenant, cycleBegan } = await seed(request, `${RUN_ID}-late`, { notice: "late", months: 3 });
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(`less than a month before leaving (due by ${day(cycleBegan)})`, { exact: false })).toBeVisible();
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
  });

  test("rent paid for after they leave is kept", async ({ page, request }) => {
    const { token, auth, tenant } = await seed(request, `${RUN_ID}-ahead`, { notice: "in time", months: 5 });
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("₹13,000 of rent paid for after they leave is kept. Rent isn't refunded.")).toBeVisible();
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
    await sheet.getByRole("button", { name: "Move out · hand back ₹10,000" }).tap();
    await expect(page.getByText("Ravi moved out · ₹10,000 handed back")).toBeVisible();

    const [s] = await (await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth })).json();
    expect(s.dues_paise).toBe(-2 * RENT);
    expect(s.advance_returned_paise).toBe(0);
  });

  test("leaving on their rent day owes nothing for the month that starts then", async ({ page, request }) => {
    // Rent falls on today's date: moved in two months ago today, paid both.
    const runId = `${RUN_ID}-rentday`;
    const { token } = await createOwner(request, runId);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, runId);
    const now = new Date();
    const [y, m, d] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
    const start = utc(y, m - 2, d);
    const tenant = await createTenantViaApi(request, token, { name: `Ravi ${runId}`, phone: phone() });
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: RENT, deposit_amount: DEPOSIT, rent_cycle: "monthly", start_date: iso(start) },
    })).json();
    for (const data of [
      { amount: DEPOSIT, kind: "deposit", payment_type: "cash", payment_date: iso(start) },
      { amount: 2 * RENT, payment_type: "online", payment_date: iso(start) },
    ]) await request.post(`${BASE}/api/stays/${stay.id}/payments`, { headers: auth, data });
    await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { notice_date: iso(utc(y, m - 1, d - 2)) } });

    // Skip the rare day this cannot be set up: a 31st with no 31st two months back.
    const p = await (await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, { headers: auth })).json();
    test.skip(new Date(`${p.start_date}T00:00:00Z`).getUTCDate() !== d, "no matching rent day this month");
    expect(p.cycles_billed).toBe(2);
    expect(p.dues_paise).toBe(0);
    expect(p.notice_on_time).toBe(true);

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Rent still owed")).toHaveCount(0);
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
  });

  test("from the grid, leaving now and settling the money later", async ({ page, request }) => {
    const { token, auth, siteId, tenant, stay, name } = await seed(request, `${RUN_ID}-grid`, { notice: "in time", months: 3 });
    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);

    // The bed panel offers the same way out as the tenant page.
    await page.getByTitle(new RegExp(`^${name} —`)).tap();
    await page.getByRole("button", { name: "Move out" }).tap();
    const sheet = page.getByRole("dialog", { name: /Move out/ });
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("10000");
    await sheet.getByRole("button", { name: "They've left · settle the money later" }).tap();
    await expect(page.getByText("Ravi moved out · money to settle later")).toBeVisible();

    // The bed is free, the stay ended, and nothing was settled yet.
    const ended = await (await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth })).json();
    expect(ended.end_date).toBeTruthy();
    expect(await (await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth })).json()).toEqual([]);

    // Later, from the tenant page: the money, against the day they left.
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Settle the money" }).tap();
    const later = page.getByRole("dialog");
    await expect(later.getByText("Left on")).toBeVisible();
    await expect(later.getByRole("button", { name: "They've left · settle the money later" })).toHaveCount(0);
    await later.getByRole("button", { name: "Settle · hand back ₹10,000" }).tap();
    await expect(page.getByText("Ravi settled · ₹10,000 handed back")).toBeVisible();
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
  });
});
