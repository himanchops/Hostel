import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs, confirmSettle } from "../helpers/api";

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
  /** depositPaid: how much of the deposit actually arrived. Defaults to all. */
  opts: { name: string; phone: string; paid: number; depositPaid?: number }
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

  // The deposit as money received, not only the term on the stay. Until
  // migration 007 this line did not exist and every test here was settling a
  // ₹17,000 deposit nobody had paid — the audit's first blocker, in the suite.
  const depositPaid = opts.depositPaid ?? DEPOSIT;
  if (depositPaid > 0) {
    const depRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: depositPaid, payment_type: "cash", kind: "deposit", payment_date: isoDate(start) },
    });
    if (!depRes.ok()) throw new Error(`addDeposit failed: ${await depRes.text()}`);
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

    // This assertion used to expect a balance of ₹8,500, on the reasoning that
    // "a settlement records what changed hands, it does not write off the rent
    // ledger". That conflated two things. The LEDGER — total_expected and
    // total_paid — is history and is still untouched below. The BALANCE is a
    // question about the present: what does this person still owe me?
    //
    // Here the owner held ₹17,000, took the ₹8,500 of dues out of it, deducted
    // ₹1,200 for electricity and handed back ₹7,300. The tenant walked away
    // square. Reading "₹8,500 owed" afterwards is how this was reported as a
    // bug from the live account.
    const summaryRes = await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth });
    const summary = await summaryRes.json();
    expect(summary.total_expected).toBe(3400000); // ledger intact
    expect(summary.total_paid).toBe(2550000);     // ledger intact
    expect(summary.balance).toBe(0);              // and the dues are settled

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
      phone: `65${RUN_ID.slice(-8)}`,
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

    // The sheet opens asking about today before it knows the stay ended, so
    // the preview answers on the stay's own end date (Oct 2026). Saving a
    // settlement for a different date is still refused: the settlement and
    // the ledger must describe one move-out.
    const asked = await request.get(
      `${BASE}/api/stays/${stay.id}/settlement-preview?end_date=${isoDate(utcToday())}`,
      { headers: auth }
    );
    expect(asked.status()).toBe(200);
    expect((await asked.json()).end_date).toBe(isoDate(endedOn));
    const conflicting = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: { adjustments: [], refund_paise: DEPOSIT, end_date: isoDate(utcToday()) },
    });
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

  // A tenant who paid ahead. What happens to the advance is the owner's call,
  // so the same fixture has to be able to end three different ways.
  test("a rent advance can come back in full, in part, or not at all", async ({ request }) => {
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    // Six months paid against four billed → ₹17,000 of advance.
    async function seedPaidAhead(suffix: string) {
      const { token } = await createOwner(request, `settle-adv-${suffix}-${RUN_ID}`);
      const { stay } = await seedStayForSettlement(request, token, {
        name: `Settle Advance ${suffix} ${RUN_ID}`,
        phone: `6${suffix}${RUN_ID.slice(-8)}`,
        paid: 5100000,
      });
      return { token, stay };
    }

    // ── The preview names the advance and opens by returning all of it ──
    const full = await seedPaidAhead("1");
    const previewRes = await request.get(
      `${BASE}/api/stays/${full.stay.id}/settlement-preview`,
      { headers: auth(full.token) }
    );
    const preview = await previewRes.json();
    expect(preview.dues_paise).toBe(-1700000);
    expect(preview.advance_paise).toBe(1700000);
    expect(preview.refund_paise).toBe(3400000); // ₹17,000 deposit + ₹17,000 advance

    // Omitting the field keeps the generous default.
    const fullRes = await request.post(`${BASE}/api/stays/${full.stay.id}/settlement`, {
      headers: auth(full.token),
      data: { adjustments: [], refund_paise: 3400000 },
    });
    expect(fullRes.status()).toBe(201);
    expect((await fullRes.json()).advance_returned_paise).toBe(1700000);

    // ── Part of it ──
    const part = await seedPaidAhead("2");
    const partRes = await request.post(`${BASE}/api/stays/${part.stay.id}/settlement`, {
      headers: auth(part.token),
      data: { adjustments: [], advance_returned_paise: 500000, refund_paise: 2200000 },
    });
    expect(partRes.status()).toBe(201);
    const partSettlement = await partRes.json();
    expect(partSettlement.advance_returned_paise).toBe(500000);
    expect(partSettlement.refund_paise).toBe(2200000); // ₹17,000 + ₹5,000

    // ── None of it: the deposit alone ──
    const none = await seedPaidAhead("3");
    const noneRes = await request.post(`${BASE}/api/stays/${none.stay.id}/settlement`, {
      headers: auth(none.token),
      data: { adjustments: [], advance_returned_paise: 0, refund_paise: DEPOSIT },
    });
    expect(noneRes.status()).toBe(201);
    expect((await noneRes.json()).refund_paise).toBe(DEPOSIT);

    // ── Returning more advance than exists is refused ──
    const over = await seedPaidAhead("4");
    const overRes = await request.post(`${BASE}/api/stays/${over.stay.id}/settlement`, {
      headers: auth(over.token),
      data: { adjustments: [], advance_returned_paise: 1700001, refund_paise: 3400001 },
    });
    expect(overRes.status()).toBe(400);
    expect((await overRes.json()).error).toContain("more advance than was paid");
  });

  // A tenant who OWES rent has no advance, so the field is not a back door for
  // inventing money.
  test("an advance cannot be returned when none was paid", async ({ request }) => {
    const { token } = await createOwner(request, `settle-noadv-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const { stay } = await seedStayForSettlement(request, token, {
      name: `Settle No Advance ${RUN_ID}`,
      phone: `63${RUN_ID.slice(-8)}`,
      paid: 2550000, // one month behind
    });

    const res = await request.post(`${BASE}/api/stays/${stay.id}/settlement`, {
      headers: auth,
      data: { adjustments: [], advance_returned_paise: 100000, refund_paise: 950000 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("no rent paid in advance");
  });

  test("owner moves a tenant out from the tenant page and the stay is marked settled", async ({ page, request }) => {
    const { token } = await createOwner(request, `settle-ui-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const name = `Settle UI ${RUN_ID}`;
    const { tenant, stay, today } = await seedStayForSettlement(request, token, {
      name,
      phone: `6${RUN_ID.slice(-9)}`,
      paid: 2550000,
    });
    // Notice on the 1st of this month: their last rent month began that day,
    // so it is in time and the deposit comes back.
    const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { notice_date: isoDate(firstOfMonth) } });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText(name).first()).toBeVisible();

    await page.getByRole("button", { name: "Move out" }).click();
    const sheet = page.getByRole("dialog");

    // The sum, and the working behind the rent still owed.
    await expect(sheet.getByText("Gave notice", { exact: false })).toContainText("in time");
    await expect(sheet.getByText("Deposit you hold")).toBeVisible();
    await expect(sheet.getByText("₹17,000", { exact: true })).toBeVisible();
    await expect(sheet.getByText("− ₹8,500")).toBeVisible();
    await sheet.getByRole("button", { name: "how?" }).click();
    await expect(sheet.getByText(/4 months billed.*₹34,000 · ₹25,500 paid/)).toBeVisible();

    // Deposit − rent owed, before anything is taken off.
    const handBack = sheet.getByLabel("Hand back (₹)");
    await expect(handBack).toHaveValue("8500");

    // One deduction, typed with the comma the rest of the app renders.
    await sheet.getByRole("button", { name: "+ Take something off" }).click();
    await sheet.getByLabel("Taken off for").fill("Unpaid electricity");
    await sheet.getByLabel("Amount taken off").fill("1,200");

    // The amount moves as it is typed.
    await expect(handBack).toHaveValue("7300");
    await sheet.getByRole("button", { name: "UPI" }).click();
    await sheet.getByRole("button", { name: "Move out · hand back ₹7,300" }).click();
    await confirmSettle(page);

    // Toast says what happened, in money.
    await expect(page.getByText("Settle moved out · ₹7,300 handed back")).toBeVisible({ timeout: 5000 });
    const [settlement] = await (await request.get(`${BASE}/api/tenants/${tenant.id}/settlements`, { headers: auth })).json();
    expect(settlement.refund_paise).toBe(730000);
    expect(settlement.refund_method).toBe("online");
    // Rent is never refunded, and there was none paid ahead to keep anyway.
    expect(settlement.advance_returned_paise).toBe(0);

    // The stay is now ended and badged, with the refund on the card.
    await expect(page.getByText("Settled", { exact: true })).toBeVisible();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await expect(page.getByText("₹7,300 refunded")).toBeVisible();

    // A tenant with one stay has its ledger open already — that is where the
    // breakdown of the refund lives, deduction included.
    await expect(page.getByRole("button", { name: /Hide ledger/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Unpaid electricity")).toBeVisible();
    await expect(page.getByText("−₹1,200")).toBeVisible();
  });

  // The UX audit's first blocker: the deposit agreed at intake was refunded as
  // if it had been received. Here none of it arrives, then part of it does.
  test("only the deposit actually received is refunded", async ({ page, request }) => {
    const { token } = await createOwner(request, `settle-held-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const name = `Settle Held ${RUN_ID}`;
    const { tenant, stay, start } = await seedStayForSettlement(request, token, {
      name,
      phone: `62${RUN_ID.slice(-8)}`,
      paid: 2550000, // one month behind
      depositPaid: 0,
    });
    const preview = async () =>
      (await request.get(`${BASE}/api/stays/${stay.id}/settlement-preview`, { headers: auth })).json();

    // ₹17,000 agreed, nothing received, ₹8,500 of rent owed: the tenant owes.
    let p = await preview();
    expect(p.deposit_agreed_paise).toBe(DEPOSIT);
    expect(p.deposit_paise).toBe(0);
    expect(p.dues_paise).toBe(850000);
    expect(p.refund_paise).toBe(-850000); // the old code offered +₹8,500 back

    // ₹10,000 of it arrives. A deposit is held, not rent: dues do not move.
    const dep = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 1000000, payment_type: "online", kind: "deposit", payment_date: isoDate(start) },
    });
    expect(dep.status()).toBe(201);
    expect((await dep.json()).kind).toBe("deposit");

    p = await preview();
    expect(p.deposit_paise).toBe(1000000);
    expect(p.total_paid).toBe(2550000);
    expect(p.dues_paise).toBe(850000);
    expect(p.refund_paise).toBe(150000); // ₹10,000 held − ₹8,500 owed

    // Nor does any other figure count it as rent.
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(summary.total_paid).toBe(2550000);
    expect(summary.balance).toBe(850000);
    const board = await (await request.get(`${BASE}/api/payments/board`, { headers: auth })).json();
    expect(board.stays.find((r: { stay_id: number }) => r.stay_id === stay.id).balance_paise).toBe(850000);

    // A kind that is neither is refused rather than quietly filed as rent.
    const bad = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 100, kind: "advance" },
    });
    expect(bad.status()).toBe(400);

    // The sheet says both figures out loud, and gives back only the one
    // received. (No notice was given, so it starts out kept.)
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Move out" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/₹17,000 agreed · ₹10,000 received/)).toBeVisible();
    await sheet.getByRole("button", { name: "Give it back" }).click();
    await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("1500");
  });
});
