import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs, confirmSettle } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `booking-${Date.now()}`;

/**
 * Some people book: they pay something to hold a place (half the rent, or
 * just the deposit) and come back on the day they want, when the owner gives
 * them a bed and takes the rest. The owner promises a place, not a particular
 * bed. A booking is a stay with no bed and an arrival date; it gets its bed
 * on arrival, or it is cancelled, billed nothing, and what they paid is kept
 * unless the owner hands some back.
 *
 * At iPad size with touch, the primary device.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

function isoIn(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

type Paid = { amount: number; kind: string; payment_type: string; payment_date: string };

async function get<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const res = await request.get(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function staysOf(request: APIRequestContext, token: string, tenantId: number) {
  return get<{ id: number; bed_id: number | null; start_date: string; end_date: string | null }[]>(
    request, token, `/api/tenants/${tenantId}/stays`);
}

async function paymentsOf(request: APIRequestContext, token: string, stayId: number): Promise<Paid[]> {
  const ps = await get<Paid[]>(request, token, `/api/stays/${stayId}/payments`);
  return ps
    .map(({ amount, kind, payment_type, payment_date }) => ({ amount, kind, payment_type, payment_date: payment_date.slice(0, 10) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount || a.payment_type.localeCompare(b.payment_type));
}

/** A booking made through the API: ₹6,000 a month and a ₹10,000 deposit. */
async function seedBooking(
  request: APIRequestContext, token: string, name: string, arrives: string,
  paid: { rent?: number; deposit?: number },
) {
  const auth = { Authorization: `Bearer ${token}` };
  const tenant = await createTenantViaApi(request, token, { name, phone: `95${Math.floor(Math.random() * 9e7 + 1e7)}` });
  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: tenant.id, rent_amount: 6_000_00, deposit_amount: 10_000_00, rent_cycle: "monthly", start_date: arrives },
  });
  expect(stayRes.ok(), await stayRes.text()).toBeTruthy();
  const stay = await stayRes.json();
  for (const [kind, amount] of [["rent", paid.rent], ["deposit", paid.deposit]] as const) {
    if (!amount) continue;
    const res = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth, data: { amount, kind, payment_type: "online", payment_date: isoIn(0) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return { tenantId: tenant.id as number, stayId: stay.id as number };
}

test("booking a place from Add tenant: no bed, an arrival day, and what they paid to hold it", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-a`);
  await createSiteRoomBed(request, token, `${RUN_ID}-a`);
  await loginAs(page, token);
  await page.goto("/tenants/new");

  const arrives = isoIn(9);
  await page.getByLabel("Full name").fill("Meera Books Ahead");
  await page.getByLabel(/^Phone/).fill("9812500001");
  await page.getByRole("button", { name: "Booking" }).tap();

  // No bed to pick: a place is promised, not a particular bed.
  await expect(page.getByRole("combobox", { name: "Bed", exact: true })).toHaveCount(0);
  await page.getByLabel("Monthly rent (₹)").fill("6000");
  await page.getByLabel("Deposit (₹)").fill("10000");
  await page.getByLabel("Arriving on").fill(arrives);

  // Nothing assumed: they paid half the rent to hold it.
  const paid = page.getByRole("region", { name: "Paid to book" });
  await expect(paid.getByLabel("Rent paid ahead (₹)")).toHaveValue("");
  await paid.getByLabel("Rent paid ahead (₹)").fill("3000");
  await paid.getByRole("button", { name: "UPI" }).tap();
  await page.getByRole("button", { name: "Add booking · ₹3,000 paid" }).tap();

  await expect(page).toHaveURL(/\/tenants\/\d+$/);
  await expect(page.getByText(`Meera Books Ahead booked from ${dayLabel(arrives)} · ₹3,000 paid`)).toBeVisible();
  await expect(page.getByText("Booked", { exact: true })).toBeVisible();
  await expect(page.getByText(`Arrives ${dayLabel(arrives)}`)).toBeVisible();
  // Not in a bed, so nothing to move out of or give notice about.
  await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move out" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record notice" })).toHaveCount(0);

  const tenantId = Number(page.url().split("/").pop());
  const [stay] = await staysOf(request, token, tenantId);
  expect(stay.bed_id).toBeNull();
  expect(stay.start_date.slice(0, 10)).toBe(arrives);
  expect(await paymentsOf(request, token, stay.id)).toEqual([
    { amount: 3_000_00, kind: "rent", payment_type: "online", payment_date: isoIn(0) },
  ]);

  // Payments says what's left and when, without a bed to name.
  await page.goto("/payments");
  await page.getByPlaceholder("Who paid? Name or room").fill("Meera");
  await expect(page.getByText("Booked, no bed yet").first()).toBeVisible();
});

test("on arrival, Assign bed takes the rest of the money", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-b`);
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-b`);
  const { tenantId, stayId } = await seedBooking(request, token, "Arriving Today", isoIn(0), { rent: 3_000_00 });
  await loginAs(page, token);
  await page.goto(`/tenants/${tenantId}`);

  await page.getByRole("button", { name: "Assign bed" }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 1 · Bed A" });
  // What's left after the ₹3,000 they paid to book, and the whole deposit.
  await expect(dialog.getByLabel("Rent still due (₹)")).toHaveValue("3000");
  await expect(dialog.getByLabel("Deposit paid (₹)")).toHaveValue("10000");
  await dialog.getByRole("button", { name: "Assign · ₹13,000 paid" }).tap();

  await expect(page.getByText("Bed assigned · ₹13,000 paid")).toBeVisible();
  await expect(page.getByText("Room 1 · Bed A")).toBeVisible();
  const [stay] = await staysOf(request, token, tenantId);
  expect(stay.bed_id).toBe(bedId);
  expect(await paymentsOf(request, token, stayId)).toEqual([
    { amount: 10_000_00, kind: "deposit", payment_type: "cash", payment_date: isoIn(0) },
    { amount: 3_000_00, kind: "rent", payment_type: "cash", payment_date: isoIn(0) },
    { amount: 3_000_00, kind: "rent", payment_type: "online", payment_date: isoIn(0) },
  ]);
});

test("someone who arrives early has their rent run from the day they came", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-c`);
  await createSiteRoomBed(request, token, `${RUN_ID}-c`);
  const { tenantId } = await seedBooking(request, token, "Early Arrival", isoIn(5), { deposit: 10_000_00 });
  await loginAs(page, token);
  await page.goto(`/tenants/${tenantId}`);

  await page.getByRole("button", { name: "Assign bed" }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 1 · Bed A" });
  await expect(dialog.getByLabel("Rent from")).toHaveValue(isoIn(5));
  await dialog.getByLabel("Rent from").fill(isoIn(0));
  await expect(dialog.getByLabel("Deposit paid (₹)")).toHaveValue("");
  await dialog.getByRole("button", { name: "Assign · ₹6,000 paid" }).tap();

  await expect(page.getByText("Bed assigned · ₹6,000 paid")).toBeVisible();
  const [stay] = await staysOf(request, token, tenantId);
  expect(stay.start_date.slice(0, 10)).toBe(isoIn(0));
});

test("cancelling a booking bills nothing and keeps what they paid", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-d`);
  const { tenantId, stayId } = await seedBooking(request, token, "Never Came", isoIn(9), { rent: 3_000_00, deposit: 5_000_00 });
  await loginAs(page, token);
  await page.goto(`/tenants/${tenantId}`);

  await page.getByRole("button", { name: "Cancel booking" }).tap();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Leaving on")).toHaveCount(0);
  await expect(sheet.getByText("They gave notice")).toHaveCount(0);
  await expect(sheet.getByText("Deposit kept: booking cancelled")).toBeVisible();
  await expect(sheet.getByText("₹3,000 of rent paid to book is kept.", { exact: false })).toBeVisible();
  await expect(sheet.getByLabel("Hand back (₹)")).toHaveValue("0");
  await sheet.getByRole("button", { name: "Cancel booking", exact: true }).tap();
  await confirmSettle(page);

  await expect(page.getByText("Never’s booking cancelled")).toBeVisible();
  await expect(page.getByText("Booking cancelled", { exact: true })).toBeVisible();

  // Cancelled before the day they were due, so dated today, start and end.
  const [stay] = await staysOf(request, token, tenantId);
  expect(stay.start_date.slice(0, 10)).toBe(isoIn(0));
  expect(stay.end_date?.slice(0, 10)).toBe(isoIn(0));
  const [settlement] = await get<{ refund_paise: number; dues_paise: number }[]>(request, token, `/api/tenants/${tenantId}/settlements`);
  expect(settlement).toMatchObject({ refund_paise: 0, dues_paise: -3_000_00 });
  // Nothing was billed, so they owe nothing.
  const summary = await get<{ total_expected: number; balance: number }>(request, token, `/api/tenants/${tenantId}/summary`);
  expect(summary.total_expected).toBe(0);
  expect(summary.balance).toBeGreaterThanOrEqual(0);
  expect(stayId).toBeGreaterThan(0);
});

test("the owner can hand back what was paid to book", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-e`);
  const { tenantId } = await seedBooking(request, token, "Refunded Booker", isoIn(4), { rent: 3_000_00 });
  await loginAs(page, token);
  await page.goto(`/tenants/${tenantId}`);

  await page.getByRole("button", { name: "Cancel booking" }).tap();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Hand back (₹)").fill("3000");
  await expect(sheet.getByText("Changed by you from ₹0.", { exact: false })).toBeVisible();
  await sheet.getByRole("button", { name: "UPI" }).tap();
  await sheet.getByRole("button", { name: "Cancel booking · hand back ₹3,000" }).tap();
  await confirmSettle(page);

  await expect(page.getByText("Refunded’s booking cancelled · ₹3,000 handed back")).toBeVisible();
  const [settlement] = await get<{ refund_paise: number; refund_method: string }[]>(request, token, `/api/tenants/${tenantId}/settlements`);
  expect(settlement).toMatchObject({ refund_paise: 3_000_00, refund_method: "online" });
});
