import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** The 1st of the month `offset` months from now, in UTC. The 1st never clamps. */
function firstOfMonth(offset: number) {
  const now = new Date();
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}

/**
 * The owner: "Rent of a long stay may eventually get bumped, it shouldn't
 * affect earlier [months]... The default behaviour should always be just to
 * change the price [from then on]." Before this, rent was rent × cycles over
 * the whole stay, so a rise turned months already paid into arrears.
 */
test.describe("Changing rent", () => {
  test("a rise from next month leaves a paid-up tenant paid up", async ({ page, request }) => {
    const { token } = await createOwner(request, `rent-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Long Stay ${RUN_ID}`, phone: "9000000003" });

    // Moved in on the 1st, four months ago: five cycles have begun, all paid.
    const start = firstOfMonth(-4);
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: start },
    })).json();
    await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 2500000, payment_type: "cash", payment_date: iso(new Date()) },
    });
    const balance = async () =>
      (await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json()).balance;
    expect(await balance()).toBe(0);

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Change rent" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("pays ₹5,000 a month");
    // Asked the owner's way (26 Oct 2026): the rent from next month, and what
    // they pay this month, which starts at the old rent.
    await dialog.getByLabel(/From next month .* rent is/).fill("5500");
    await expect(dialog.getByRole("button", { name: "The old rent, ₹5,000" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByTestId("rent-summary")).toContainText("From 1 ");
    await expect(dialog.getByTestId("rent-summary")).toContainText("₹5,500 a month");
    await expect(dialog.getByTestId("rent-summary")).toContainText("Nothing more is due.");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Rent is ₹5,500 from/)).toBeVisible();
    await expect(page.getByText(/₹5,000 a month → ₹5,500 from/)).toBeVisible();
    // The point of the whole change: nothing already billed moved.
    expect(await balance()).toBe(0);
  });

  test("a change dated in the past bills only the cycles from that date", async ({ request }) => {
    const { token } = await createOwner(request, `rent-past-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-past-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Backdated ${RUN_ID}`, phone: "9000000004" });
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-4) },
    })).json();
    await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 2500000, payment_type: "cash", payment_date: iso(new Date()) },
    });

    // ₹6,000 from last month's cycle: two of the five cycles at the new rent.
    const res = await request.post(`${BASE}/api/stays/${stay.id}/rent-changes`, {
      headers: auth,
      data: { rent_amount: 600000, effective_date: firstOfMonth(-1) },
    });
    expect(res.status()).toBe(200);
    const changed = await res.json();
    expect(changed.rent_amount).toBe(600000);
    expect(changed.rent_changes.map((c: { rent_amount: number }) => c.rent_amount)).toEqual([500000, 600000]);

    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(summary.total_expected).toBe(3 * 500000 + 2 * 600000);
    expect(summary.balance).toBe(200000);

    // Correcting the whole stay is the old behaviour on purpose, and clears
    // the schedule: five cycles at ₹5,000, paid in full.
    const corrected = await (await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth, data: { rent_amount: 500000 },
    })).json();
    expect(corrected.rent_changes).toBeUndefined();
    const after = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(after.balance).toBe(0);

    // A date on or before move-in is a correction, not a change.
    const early = await request.post(`${BASE}/api/stays/${stay.id}/rent-changes`, {
      headers: auth, data: { rent_amount: 600000, effective_date: firstOfMonth(-4) },
    });
    expect(early.status()).toBe(400);
  });

  test("correcting the whole stay is reachable but not the default", async ({ page, request }) => {
    const { token } = await createOwner(request, `rent-fix-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-fix-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Typo ${RUN_ID}`, phone: "9000000005" });
    await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 50000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-2) },
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Change rent" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Entered it wrong at move-in?" }).click();
    await expect(dialog).toContainText("Use this only to fix a mistake");
    await dialog.getByLabel(/New rent/).fill("5000");
    await dialog.getByRole("button", { name: "Correct whole stay" }).click();

    await expect(page.getByText("Rent corrected to ₹5,000 for the whole stay")).toBeVisible();
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(summary.total_expected).toBe(3 * 500000);
  });

  test("a settled stay's rent cannot change", async ({ request }) => {
    const { token } = await createOwner(request, `rent-settled-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-settled-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Settled ${RUN_ID}`, phone: "9000000006" });
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-2) },
    })).json();
    const settle = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      // Three cycles billed, nothing paid, no deposit: the tenant owes ₹15,000.
      headers: auth, data: { end_date: iso(new Date()), adjustments: [], refund_paise: -1500000 },
    });
    expect(settle.ok(), await settle.text()).toBeTruthy();

    const res = await request.post(`${BASE}/api/stays/${stay.id}/rent-changes`, {
      headers: auth, data: { rent_amount: 600000, effective_date: firstOfMonth(-1) },
    });
    expect(res.status()).toBe(409);
  });

  test("a different date is still there for a deal further out", async ({ page, request }) => {
    const { token } = await createOwner(request, `rent-date-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-date-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Far Out ${RUN_ID}`, phone: "9000000006" });
    await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-1) },
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Change rent" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "A different date" }).click();
    await dialog.getByLabel(/New rent/).fill("6000");
    await dialog.getByLabel(/Starting from/).fill(firstOfMonth(2));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Rent is ₹6,000 from/)).toBeVisible();
  });

  /**
   * stays.rent_amount is the latest scheduled rent. With a rise already set
   * for next month, the dialogs once called that "the old rent" while the
   * summary below said otherwise (owner's demo, 26 Oct 2026).
   */
  test("with a rise already scheduled, the old rent is this month's", async ({ page, request }) => {
    const { token } = await createOwner(request, `rent-sched-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `rent-sched-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Scheduled ${RUN_ID}`, phone: "9000000007" });
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 850000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-1) },
    })).json();
    await request.post(`${BASE}/api/stays/${stay.id}/rent-changes`, {
      headers: auth, data: { rent_amount: 900000, effective_date: firstOfMonth(1) },
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Change rent" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("pays ₹8,500 a month, ₹9,000 from");
    await dialog.getByLabel(/From next month .* rent is/).fill("9500");
    await expect(dialog.getByRole("button", { name: "The old rent, ₹8,500" })).toBeVisible();
    await expect(dialog.getByTestId("rent-summary")).toContainText("is ₹8,500");
  });
});
