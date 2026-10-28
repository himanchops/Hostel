import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `dep-${Date.now()}`;

/**
 * Payments' "Deposit still owed" (Oct 2026): everyone in a bed who has paid
 * less of their deposit than they agreed, recorded in place as a deposit,
 * never as rent. On the owner's iPad, portrait, with touch.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

function phone(): string {
  return `97${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}
function daysAgo(n: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n)).toISOString().slice(0, 10);
}

/**
 * Four tenants, all paid up on rent:
 *   None     ₹10,000 agreed, nothing paid
 *   Half     ₹10,000 agreed, ₹4,000 paid
 *   Full     ₹10,000 agreed, all paid: not on the list
 *   Booking  ₹10,000 agreed, no bed yet: not on the list, pays on arrival
 */
async function seed(request: APIRequestContext) {
  const { token } = await createOwner(request, RUN_ID);
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, RUN_ID);
  const beds: (number | undefined)[] = [bedId];
  for (const name of ["Bed B", "Bed C"]) {
    const res = await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name } });
    beds.push((await res.json()).id);
  }
  beds.push(undefined);

  const stays: Record<string, number> = {};
  for (const [i, [name, depositPaid]] of ([
    ["None", 0], ["Half", 4000], ["Full", 10000], ["Booking", 0],
  ] as const).entries()) {
    const tenant = await createTenantViaApi(request, token, { name: `${name} ${RUN_ID}`, phone: phone() });
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id, bed_id: beds[i], rent_amount: 700000, deposit_amount: 1000000,
        rent_cycle: "monthly", start_date: daysAgo(10),
      },
    });
    if (!res.ok()) throw new Error(`stay failed: ${await res.text()}`);
    const stay = (await res.json()).id;
    stays[name] = stay;
    const pay = (amount: number, kind: string) => request.post(`${BASE}/api/stays/${stay}/payments`, {
      headers: auth,
      data: { amount, payment_type: "cash", kind, payment_date: daysAgo(10) },
    });
    await pay(700000, "rent");
    if (depositPaid > 0) await pay(depositPaid * 100, "deposit");
  }
  return { token, stays };
}

test("deposits still owed: listed apart from rent, and recorded as a deposit", async ({ page, request }) => {
  const { token, stays } = await seed(request);
  const auth = { Authorization: `Bearer ${token}` };

  // The board says what is left, and nothing for the paid or the booking.
  const board = await (await request.get(`${BASE}/api/payments/board`, { headers: auth })).json();
  const byStay = (id: number) => board.stays.find((r: { stay_id: number }) => r.stay_id === id);
  expect(byStay(stays.None)).toMatchObject({ deposit_owed_paise: 1000000, deposit_amount: 1000000, balance_paise: 0 });
  expect(byStay(stays.Half)).toMatchObject({ deposit_owed_paise: 600000, deposit_amount: 1000000 });
  expect(byStay(stays.Full).deposit_owed_paise).toBeUndefined();
  expect(byStay(stays.Booking).deposit_owed_paise).toBeUndefined();

  await loginAs(page, token);
  await page.goto("/payments");
  const section = page.getByRole("region", { name: "Deposit still owed" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("link", { name: /^(None|Half|Full|Booking) / })).toHaveCount(2);
  await expect(section.getByText("₹10,000 agreed, none paid")).toBeVisible();
  await expect(section.getByText("₹4,000 of ₹10,000 paid", { exact: false })).toBeVisible();

  // Rent is paid up for all four, so nothing is overdue or due: a deposit is
  // not rent, and must not put anyone on those lists.
  await expect(page.getByRole("region", { name: "Overdue" })).toHaveCount(0);
  await expect(page.getByText("Nobody is due this week")).toBeVisible();

  // Record the ₹6,000 left, prefilled, by UPI.
  // Rows come in the board's order, one Record button each.
  const names = await section.getByRole("link").allTextContents();
  await section.getByRole("button", { name: "Record" }).nth(names.indexOf(`Half ${RUN_ID}`)).tap();
  const form = section.locator("form");
  await expect(form.getByLabel("Amount (₹)")).toHaveValue("6000");
  await form.getByRole("button", { name: "UPI" }).tap();
  await form.getByRole("button", { name: "Save ₹6,000 deposit" }).tap();
  await expect(page.getByText(`Recorded ₹6,000 deposit from Half`)).toBeVisible();

  // Off the list, and saved as a deposit: rent untouched.
  await expect(section.getByRole("link", { name: `Half ${RUN_ID}` })).toHaveCount(0);
  await expect(section.getByRole("link", { name: `None ${RUN_ID}` })).toBeVisible();
  const payments = await (await request.get(`${BASE}/api/stays/${stays.Half}/payments`, { headers: auth })).json();
  const saved = payments.find((p: { amount: number; kind: string }) => p.amount === 600000);
  expect(saved).toMatchObject({ kind: "deposit", payment_type: "online", is_approved: true });
  const after = await (await request.get(`${BASE}/api/payments/board`, { headers: auth })).json();
  const halfRow = after.stays.find((r: { stay_id: number }) => r.stay_id === stays.Half);
  expect(halfRow.deposit_owed_paise).toBeUndefined();
  expect(halfRow.balance_paise).toBe(0);
});

test("no section at all when every deposit is paid", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-none`);
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-none`);
  const tenant = await createTenantViaApi(request, token, { name: `Paid ${RUN_ID}`, phone: phone() });
  await request.post(`${BASE}/api/stays`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 700000, deposit_amount: 0, rent_cycle: "monthly", start_date: daysAgo(3) },
  });
  await loginAs(page, token);
  await page.goto("/payments");
  // Their first rent is unpaid, so the page has loaded once Overdue shows.
  await expect(page.getByRole("region", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Deposit still owed" })).toHaveCount(0);
});
