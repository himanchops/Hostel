import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `ins-${Date.now()}`;

/**
 * UTC for the same reason collections.test.ts is: the backend takes "today" as
 * UTC midnight, and local dates disagree with it either side of midnight.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The 1st of a month relative to this one. Every date below is a 1st, so no
 *  figure depends on which day of the month the suite runs. */
function firstOf(offset: number): Date {
  const t = utcToday();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthName(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function phone(): string {
  return `98${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * Four tenants, one building, and a current month that has every kind of
 * money in it:
 *
 *   A  in since two months back, ₹8,000 rent paid every 1st; ₹2,000 deposit
 *      paid at move-in and still held.
 *   B  in since last month, ₹5,000 rent, paid only the first month; ₹3,000
 *      deposit. Settled on this month's 1st: the deposit pays ₹3,000 of the
 *      ₹5,000 owed and they leave owing ₹2,000. No money moves that day.
 *   C  in since last month, ₹4,000 rent, paid both months; ₹2,500 deposit.
 *      Settled on this month's 1st, square: the whole ₹2,500 is handed back.
 *   D  moved in this month's 1st, ₹6,000 rent and ₹1,500 deposit, both paid.
 *
 * This month, then:
 *   billed     8,000 + 5,000 + 4,000 + 6,000             = ₹23,000
 *   rent       8,000 + 4,000 + 6,000 paid + 3,000 from B's deposit = ₹21,000 (91%)
 *   money      18,000 rent + 1,500 deposit − 2,500 returned       = ₹17,000
 *   held now   A's 2,000 + D's 1,500 (B and C are settled)        = ₹3,500
 */
async function seedMonth(request: APIRequestContext, runId: string) {
  const { token } = await createOwner(request, runId);
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, runId);
  const beds = [bedId];
  for (const name of ["Bed B", "Bed C", "Bed D"]) {
    const res = await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name } });
    expect(res.ok()).toBeTruthy();
    beds.push((await res.json()).id);
  }

  async function stay(name: string, bed: number, startOffset: number, rent: number, deposit: number) {
    const tenant = await createTenantViaApi(request, token, { name, phone: phone() });
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: bed, rent_amount: rent * 100, deposit_amount: deposit * 100,
        rent_cycle: "monthly", start_date: isoDate(firstOf(startOffset)),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const s = await res.json();
    return { tenantId: tenant.id as number, stayId: s.id as number };
  }
  async function pay(stayId: number, rupees: number, offset: number, kind: "rent" | "deposit") {
    const res = await request.post(`${BASE}/api/stays/${stayId}/payments`, {
      headers: auth,
      data: { amount: rupees * 100, payment_type: "cash", kind, payment_date: isoDate(firstOf(offset)) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  async function settle(stayId: number) {
    const endDate = isoDate(firstOf(0));
    const preview = await request.get(`${BASE}/api/stays/${stayId}/settlement-preview?end_date=${endDate}`, { headers: auth });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const { refund_paise } = await preview.json();
    const res = await request.post(`${BASE}/api/stays/${stayId}/settlement`, {
      headers: auth,
      data: { end_date: endDate, refund_paise, adjustments: [] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  const a = await stay("Tenant Alpha", beds[0], -2, 8000, 2000);
  await pay(a.stayId, 2000, -2, "deposit");
  for (const m of [-2, -1, 0]) await pay(a.stayId, 8000, m, "rent");

  const b = await stay("Tenant Bravo", beds[1], -1, 5000, 3000);
  await pay(b.stayId, 3000, -1, "deposit");
  await pay(b.stayId, 5000, -1, "rent");
  await settle(b.stayId);

  const c = await stay("Tenant Charlie", beds[2], -1, 4000, 2500);
  await pay(c.stayId, 2500, -1, "deposit");
  await pay(c.stayId, 4000, -1, "rent");
  await pay(c.stayId, 4000, 0, "rent");
  await settle(c.stayId);

  const d = await stay("Tenant Delta", beds[3], 0, 6000, 1500);
  await pay(d.stayId, 1500, 0, "deposit");
  await pay(d.stayId, 6000, 0, "rent");

  return { token, delta: d.tenantId };
}

function monthRow(page: Page, d: Date) {
  return page.getByRole("row").filter({ has: page.getByRole("button", { name: monthName(d) }) });
}

test.describe("Insights", () => {
  test("the rent view counts rent, including rent a deposit paid off at move-out", async ({ page, request }) => {
    const { token } = await seedMonth(request, `${RUN_ID}-rent`);
    await loginAs(page, token);
    await page.goto("/insights");

    await expect(page.getByRole("button", { name: "Rent", exact: true })).toHaveAttribute("aria-pressed", "true");
    const row = monthRow(page, firstOf(0));
    await expect(row).toContainText("₹23,000");
    await expect(row).toContainText("₹21,000");
    await expect(row).toContainText("91%");

    // Tapping the month lists what makes up its figure, and they add up to it.
    await row.getByRole("button").click();
    await expect(page.getByRole("listitem").filter({ hasText: "Paid from deposit" })).toContainText("₹3,000");
    await expect(page.getByText("Collected: ₹21,000")).toBeVisible();
    // A deposit is not rent: it is not listed in this view.
    await expect(page.getByText("Deposit", { exact: true })).toHaveCount(0);
  });

  test("the all-money view nets deposits in against refunds out, and is remembered", async ({ page, request }) => {
    const { token } = await seedMonth(request, `${RUN_ID}-money`);
    await loginAs(page, token);
    await page.goto("/insights");

    await page.getByRole("button", { name: "All money" }).click();
    const row = monthRow(page, firstOf(0));
    await expect(row).toContainText("₹18,000");
    await expect(row).toContainText("+₹1,500");
    await expect(row).toContainText("−₹2,500");
    await expect(row).toContainText("₹17,000");

    await expect(page.getByText("Deposits you hold").locator("..")).toContainText("₹3,500");
    // Net, not "in". Over the default 12 months: ₹9,000 of deposits came in
    // (A, B, C, D) and C's ₹2,500 went back.
    const net = page.getByText("Deposits, net").locator("..");
    await expect(net).toContainText("+₹6,500");
    await expect(net).toContainText("₹9,000 in · ₹2,500 back");
    // This month alone, more went back than came in, and it says so.
    await page.getByRole("button", { name: "1m" }).click();
    await expect(net).toContainText("−₹1,000");
    await expect(net).toContainText("₹1,500 in · ₹2,500 back");
    await page.getByRole("button", { name: "12m" }).click();

    await row.getByRole("button").click();
    await expect(page.getByRole("listitem").filter({ hasText: "Returned" })).toContainText("−₹2,500");
    // Newest first, whatever the kind: the dates down the list never go up.
    const dates = await page.getByRole("listitem").evaluateAll((items) =>
      items.map((li) => li.firstElementChild?.textContent ?? ""));
    const day = (d: string) => Number(d.split(" ")[0]);
    expect(dates.map(day)).toEqual([...dates.map(day)].sort((a, b) => b - a));
    await expect(page.getByText("Net in: ₹17,000")).toBeVisible();
    // The deposit that paid rent moved no money, so it is not a line here.
    await expect(page.getByRole("listitem").filter({ hasText: "Paid from deposit" })).toHaveCount(0);

    // Opening the page again keeps the view the owner last used.
    await page.reload();
    await expect(page.getByRole("button", { name: "All money" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the dashboard tile and the tenant page say where deposits went", async ({ page, request }) => {
    const { token, delta } = await seedMonth(request, `${RUN_ID}-tiles`);
    await loginAs(page, token);

    await page.goto("/dashboard");
    // The tile is the last row of the Insights table, both views.
    await expect(page.getByText("Collected This Month").locator("..").locator("..")).toContainText("₹21,000");
    await expect(page.getByText("All money in: ₹17,000")).toBeVisible();

    await page.goto(`/tenants/${delta}`);
    const tile = page.getByText("Rent paid").locator("..");
    await expect(tile).toContainText("₹6,000");
    await expect(tile).toContainText("+ ₹1,500 deposit held");
  });

  test("shows a full-house room and a never-let room side by side", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-rooms`);
    const auth = { Authorization: `Bearer ${token}` };
    const roomA = await createSiteRoomBed(request, token, `${RUN_ID}-a`);

    const roomBRes = await request.post(`${BASE}/api/sites/${roomA.siteId}/rooms`, {
      headers: auth, data: { name: "Empty Room", floor: 0 },
    });
    expect(roomBRes.ok()).toBeTruthy();
    const roomB = await roomBRes.json();
    const bedRes = await request.post(`${BASE}/api/sites/${roomA.siteId}/rooms/${roomB.id}/beds`, {
      headers: auth, data: { name: "1L" },
    });
    expect(bedRes.ok()).toBeTruthy();

    const tenant = await createTenantViaApi(request, token, { name: "Insight Tenant", phone: phone() });
    const stayRes = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: roomA.bedId, rent_amount: 800000, deposit_amount: 0,
        rent_cycle: "monthly", start_date: isoDate(firstOf(-2)),
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const stay = await stayRes.json();
    const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth, data: { amount: 800000, payment_type: "cash", payment_date: isoDate(firstOf(-2)) },
    });
    expect(payRes.ok()).toBeTruthy();

    await loginAs(page, token);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();

    // Months before the first tenant are not listed; the first one is.
    await expect(monthRow(page, firstOf(-2))).toContainText("₹8,000");
    await expect(monthRow(page, firstOf(-3))).toHaveCount(0);

    // "By room" is shut by default, and its summary has to be worth reading
    // shut — it names the room earning nothing without being opened.
    const byRoom = page.getByRole("button", { name: /By room/ });
    await expect(byRoom).toHaveAttribute("aria-expanded", "false");
    await expect(byRoom).toContainText("never let");
    await byRoom.click();

    const occupied = page.getByRole("row", { name: /Room 1\b/ });
    const empty = page.getByRole("row", { name: /Empty Room/ });
    await expect(occupied).toContainText("₹8,000");
    await expect(empty).toContainText("₹0");
    await expect(empty).toContainText("0%");
  });

  test("a busy month leads with its totals, lists newest first, and shows ten lines until asked", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-busy`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-busy`);
    const tenant = await createTenantViaApi(request, token, { name: "Busy Tenant", phone: phone() });
    const last = firstOf(-1);
    const day = (n: number) => new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), n));
    const stayRes = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: bedId, rent_amount: 100000, deposit_amount: 50000,
        rent_cycle: "monthly", start_date: isoDate(last),
      },
    });
    const stay = await stayRes.json();
    // Twelve ₹1,000 rent payments on the 1st to the 12th of last month, and a
    // deposit on the 5th, which belongs in the middle of the list, not on top.
    for (let d = 1; d <= 12; d++) {
      await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
        headers: auth, data: { amount: 100000, payment_type: "cash", payment_date: isoDate(day(d)) },
      });
    }
    await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth, data: { amount: 50000, payment_type: "cash", kind: "deposit", payment_date: isoDate(day(5)) },
    });

    await loginAs(page, token);
    await page.goto("/insights");
    await page.getByRole("button", { name: "All money" }).click();
    await monthRow(page, last).getByRole("button").click();

    const lines = page.getByRole("listitem");
    await expect(lines).toHaveCount(10);
    await expect(page.getByText("×12")).toBeVisible();
    await expect(lines.first()).toContainText("12 ");

    await page.getByRole("button", { name: "Show all 13 lines" }).click();
    await expect(lines).toHaveCount(13);
    const days = (await lines.evaluateAll((items) => items.map((li) => li.firstElementChild?.textContent ?? "")))
      .map((t) => Number(t.split(" ")[0]));
    expect(days).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 5, 4, 3, 2, 1]);

    await page.getByRole("button", { name: `Close ${monthName(last)}` }).click();
    await expect(lines).toHaveCount(0);
  });

  test("range picker narrows the window, down to this month, and is remembered", async ({ page, request }) => {
    const { token } = await seedYear(request, `${RUN_ID}-range`);
    await loginAs(page, token);
    await page.goto("/insights");

    await expect(page.getByText(`${monthName(firstOf(-11))} to ${monthName(firstOf(0))}`)).toBeVisible();
    await page.getByRole("button", { name: "3m" }).click();
    await expect(page.getByText(`${monthName(firstOf(-2))} to ${monthName(firstOf(0))}`)).toBeVisible();
    await expect(monthRow(page, firstOf(-3))).toHaveCount(0);

    // 1m is this month alone: the tiles become this month's figures.
    await page.getByRole("button", { name: "1m" }).click();
    await expect(page.getByText(`${monthName(firstOf(0))} to ${monthName(firstOf(0))}`)).toBeVisible();
    await expect(page.getByText("Rent collected").locator("..")).toContainText("₹8,000");

    // Coming back shows 1m's figures, not only a pressed 1m button. It used to
    // load twelve months first and the remembered one second, and whichever
    // answer landed last won.
    await page.reload();
    await expect(page.getByRole("button", { name: "1m" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(`${monthName(firstOf(0))} to ${monthName(firstOf(0))}`)).toBeVisible();
    await expect(monthRow(page, firstOf(-1))).toHaveCount(0);
  });

  test("a slow answer for an earlier range never replaces a newer one", async ({ page, request }) => {
    const { token } = await seedYear(request, `${RUN_ID}-race`);
    await loginAs(page, token);
    await page.goto("/insights");
    await expect(page.getByText(`${monthName(firstOf(-11))} to ${monthName(firstOf(0))}`)).toBeVisible();

    // 6m answers slowly; 1m is tapped while it is still on its way.
    await page.route("**/api/insights?months=6", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole("button", { name: "6m" }).click();
    await page.getByRole("button", { name: "1m" }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(`${monthName(firstOf(0))} to ${monthName(firstOf(0))}`)).toBeVisible();
    await expect(monthRow(page, firstOf(-1))).toHaveCount(0);
  });

  /**
   * The bar chart this table replaced needed a sideways scroller at 375px and
   * drifted left on the iPad. The table must fit every screen the owner uses,
   * with the figure that matters — net money in — on screen without scrolling.
   */
  for (const vp of [
    { name: "a 375px phone", width: 375, height: 812 },
    { name: "an iPad in portrait", width: 768, height: 1024 },
    { name: "an iPad in landscape", width: 1024, height: 768 },
  ]) {
    test(`the money table fits ${vp.name}`, async ({ page, request }) => {
      const { token } = await seedYear(request, `${RUN_ID}-vp${vp.width}`);
      await loginAs(page, token);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/insights");

      for (const view of ["Rent", "All money"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        const table = page.getByRole("table").first();
        const fit = await table.evaluate((el) => {
          const wrap = el.parentElement!;
          const r = wrap.getBoundingClientRect();
          return { left: r.left, right: r.right, scroll: wrap.scrollWidth - wrap.clientWidth };
        });
        expect(fit.left).toBeGreaterThanOrEqual(0);
        expect(fit.right).toBeLessThanOrEqual(vp.width);
        expect(fit.scroll, `${view} table scrolls sideways`).toBeLessThanOrEqual(1);
      }
      await expect(page.getByRole("columnheader", { name: "Net in" })).toBeVisible();

      expect(await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )).toBeLessThanOrEqual(1);
    });
  }
});

/** A tenant in since the 1st, eleven months back, paying ₹8,000 on every 1st since: twelve active months. */
async function seedYear(request: APIRequestContext, runId: string) {
  const { token } = await createOwner(request, runId);
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, runId);
  const tenant = await createTenantViaApi(request, token, { name: "Year Tenant", phone: phone() });

  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 800000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: isoDate(firstOf(-11)),
    },
  });
  expect(stayRes.ok()).toBeTruthy();
  const stay = await stayRes.json();

  for (let m = -11; m <= 0; m++) {
    const pay = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 800000, payment_type: "online", payment_date: isoDate(firstOf(m)) },
    });
    expect(pay.ok()).toBeTruthy();
  }
  return { token };
}
