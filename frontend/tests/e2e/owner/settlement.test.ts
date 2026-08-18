import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Dates are computed in UTC because the backend takes "today" as UTC midnight,
 * and so does the frontend's today() (it slices an ISO string). Using local
 * dates here would disagree with both for a few hours either side of midnight.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const RENT = 850000; // ₹8,500/month
const DEPOSIT = 1700000; // ₹17,000

/**
 * A tenant three months in, one month behind, with a deposit held.
 *
 * Anchored to the 1st, three calendar months back: the anchor day is never
 * later than today's date, so exactly four cycles are billed no matter which
 * day of the month this test runs on.
 *
 *   4 × ₹8,500 = ₹34,000 billed · ₹25,500 paid → ₹8,500 outstanding
 */
async function seedStayForSettlement(
  request: APIRequestContext,
  token: string,
  opts: { name: string; phone: string; paid: number }
) {
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${opts.phone.slice(-4)}`);
  const tenant = await createTenantViaApi(request, token, { name: opts.name, phone: opts.phone });

  const today = utcToday();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));

  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id,
      bed_id: bedId,
      rent_amount: RENT,
      deposit_amount: DEPOSIT,
      rent_cycle: "monthly",
      start_date: isoDate(start),
    },
  });
  if (!stayRes.ok()) throw new Error(`createStay failed: ${await stayRes.text()}`);
  const stay = await stayRes.json();

  // Three separate payments, so any figure that scales with the payment count
  // shows up as wrong rather than coincidentally right.
  for (let i = 0; i < 3; i++) {
    const when = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 2));
    const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: opts.paid / 3, payment_type: "cash", payment_date: isoDate(when) },
    });
    if (!payRes.ok()) throw new Error(`addPayment failed: ${await payRes.text()}`);
  }

  return { tenant, stay, start, today, bedId };
}

test.describe("Settlement", () => {
  test("preview shows the working, and settling stores the exact refund", async ({ request }) => {
    const { token } = await createOwner(request, `settle-api-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { tenant, stay, today } = await seedStayForSettlement(request, token, {
      name: `Settle API ${RUN_ID}`,
      phone: `9${RUN_ID.slice(-9)}`,
      paid: 2550000, // three months of four
    });

    // ── Preview ──
    const previewRes = await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, { headers: auth });
    expect(previewRes.status()).toBe(200);
    const preview = await previewRes.json();

    expect(preview.deposit_paise).toBe(DEPOSIT);
    expect(preview.cycles_billed).toBe(4);
    expect(preview.total_expected).toBe(3400000);
    expect(preview.total_paid).toBe(2550000);
    expect(preview.dues_paise).toBe(850000);
    expect(preview.refund_paise).toBe(850000); // deposit − dues, before adjustments
    expect(preview.already_ended).toBe(false);
    expect(preview.end_date).toBe(isoDate(today));

    // Nothing was recorded by looking. The status is asserted first on
    // purpose: an error body has no end_date either, so checking the field
    // alone passes whether the stay is open or the request failed — which is
    // exactly how GET /api/stays/:id was found to have been 404ing on every
    // stay (ambiguous `id` across the tenants join).
    const stillOpen = await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth });
    expect(stillOpen.status()).toBe(200);
    expect((await stillOpen.json()).end_date).toBeUndefined();

    // ── Settle: ₹17,000 − ₹8,500 − ₹1,200 = ₹7,300 ──
    const settleRes = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: {
        adjustments: [{ label: "Unpaid electricity", amount_paise: -120000 }],
        notes: "Handed over in cash.",
        refund_paise: 730000,
        end_date: isoDate(today),
      },
    });
    expect(settleRes.status()).toBe(201);
    const settlement = await settleRes.json();

    expect(settlement.refund_paise).toBe(730000);
    expect(settlement.deposit_paise).toBe(DEPOSIT);
    expect(settlement.dues_paise).toBe(850000);
    expect(settlement.adjustments).toEqual([{ label: "Unpaid electricity", amount_paise: -120000 }]);
    expect(settlement.notes).toBe("Handed over in cash.");

    // ── Settling ended the stay, which frees the bed ──
    const ended = await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth });
    expect(ended.status()).toBe(200);
    expect((await ended.json()).end_date.slice(0, 10)).toBe(isoDate(today));

    // ── And it reads back on the tenant ──
    const listRes = await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth });
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].stay_id).toBe(stay.id);
    expect(list[0].refund_paise).toBe(730000);

    // The summary still owes the same ₹8,500: a settlement records what
    // changed hands, it does not write off the rent ledger.
    const summaryRes = await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth });
    const summary = await summaryRes.json();
    expect(summary.total_expected).toBe(3400000);
    expect(summary.total_paid).toBe(2550000);
    expect(summary.balance).toBe(850000);

    // ── Settling twice is refused ──
    const again = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: { adjustments: [], refund_paise: 850000 },
    });
    expect(again.status()).toBe(409);
  });

  // The server recomputes rather than storing what it is handed. The realistic
  // trigger is a stale drawer — a payment recorded in another tab moves the
  // dues while the calculator is open.
  test("a refund that does not match the figures is refused", async ({ request }) => {
    const { token } = await createOwner(request, `settle-mismatch-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { stay } = await seedStayForSettlement(request, token, {
      name: `Settle Mismatch ${RUN_ID}`,
      phone: `8${RUN_ID.slice(-9)}`,
      paid: 2550000,
    });

    const res = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: {
        adjustments: [{ label: "Unpaid electricity", amount_paise: -120000 }],
        refund_paise: 900000, // the honest answer is 730000
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("refund does not match");

    // Nothing was written, and the stay is still open.
    const stayRes = await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth });
    expect((await stayRes.json()).end_date).toBeFalsy();
  });

  test("an adjustment with no reason is refused", async ({ request }) => {
    const { token } = await createOwner(request, `settle-label-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { stay } = await seedStayForSettlement(request, token, {
      name: `Settle Label ${RUN_ID}`,
      phone: `7${RUN_ID.slice(-9)}`,
      paid: 2550000,
    });

    const res = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: { adjustments: [{ label: "  ", amount_paise: -50000 }], refund_paise: 800000 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("label");
  });

  // The other order: the stay was ended first (from the grid, or with "End
  // without settling"), and the deposit is dealt with afterwards. Rent must be
  // billed to the date the stay records, not to today.
  test("a stay that already ended settles against its own end date", async ({ request }) => {
    const { token } = await createOwner(request, `settle-ended-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { stay, start } = await seedStayForSettlement(request, token, {
      name: `Settle Ended ${RUN_ID}`,
      phone: `5${RUN_ID.slice(-9)}`,
      paid: 2550000,
    });

    // End it one day short of the fourth cycle's anchor: three cycles billed,
    // three paid, so nothing is outstanding and the whole deposit goes back.
    const endedOn = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
    const endRes = await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { end_date: isoDate(endedOn) },
    });
    expect(endRes.status()).toBe(200);

    const previewRes = await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, { headers: auth });
    const preview = await previewRes.json();
    expect(preview.already_ended).toBe(true);
    expect(preview.end_date).toBe(isoDate(endedOn));
    expect(preview.cycles_billed).toBe(3);
    expect(preview.dues_paise).toBe(0);
    expect(preview.refund_paise).toBe(DEPOSIT);

    // Asking to bill to a different date is refused rather than silently
    // ignored — the settlement and the ledger must describe one move-out.
    const conflicting = await request.get(
      `${BASE}/api/stays/${stay.id}/settlement-preview?end_date=${isoDate(utcToday())}`,
      { headers: auth }
    );
    expect(conflicting.status()).toBe(400);
    expect((await conflicting.json()).error).toContain("already ended");

    const settleRes = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: { adjustments: [], refund_paise: DEPOSIT },
    });
    expect(settleRes.status()).toBe(201);
    expect((await settleRes.json()).refund_paise).toBe(DEPOSIT);

    // Settling did not move the end date it was already given.
    const after = await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth });
    expect((await after.json()).end_date.slice(0, 10)).toBe(isoDate(endedOn));
  });

  test("owner settles from the tenant page and the stay is marked settled", async ({ page, request }) => {
    const { token } = await createOwner(request, `settle-ui-${RUN_ID}`);
    const name = `Settle UI ${RUN_ID}`;
    const { tenant } = await seedStayForSettlement(request, token, {
      name,
      phone: `6${RUN_ID.slice(-9)}`,
      paid: 2550000,
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText(name).first()).toBeVisible();

    await page.getByRole("button", { name: "Settle & vacate" }).click();

    // The two computed lines, and the working behind the outstanding rent.
    await expect(page.getByText("Deposit held")).toBeVisible();
    await expect(page.getByText("₹17,000", { exact: true })).toBeVisible();
    await expect(page.getByText("Rent outstanding")).toBeVisible();
    await expect(page.getByText("4 months × ₹8,500 = ₹34,000 billed · ₹25,500 paid")).toBeVisible();

    // Deposit − dues, before any adjustment.
    const refund = page.getByText("Refund to tenant").locator("..").locator("p").nth(1);
    await expect(refund).toHaveText("₹8,500");

    // One deduction, typed with the comma the rest of the app renders.
    await page.getByRole("button", { name: "+ Add adjustment" }).click();
    await page.getByLabel("Adjustment reason").fill("Unpaid electricity");
    await page.getByLabel("Adjustment amount").fill("1,200");

    // The refund moves as it is typed — that is the whole point of the drawer.
    await expect(refund).toHaveText("₹7,300");

    await page.getByRole("button", { name: "Settle & vacate", exact: true }).last().click();

    // Toast says what happened, in money.
    await expect(page.getByText(`Settled — ₹7,300 back to ${name}`)).toBeVisible({ timeout: 5000 });

    // The stay is now ended and badged, with the refund on the card.
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await expect(page.getByText("₹7,300 refunded")).toBeVisible();

    // Expanding shows what the refund was made of, deduction included.
    await page.getByText("Ended", { exact: true }).click();
    await expect(page.getByText("Unpaid electricity")).toBeVisible();
    await expect(page.getByText("−₹1,200")).toBeVisible();
  });
});
