import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Dates are computed in UTC because the backend takes "today" as
 * time.Now().Truncate(24h), which is UTC midnight. Using local dates here would
 * disagree with the server for a few hours either side of midnight.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

async function seedOverdueStay(
  request: APIRequestContext,
  token: string,
  opts: { phone: string; name: string; rent: number; paid: number }
) {
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${opts.phone.slice(-4)}`);
  const tenant = await createTenantViaApi(request, token, { name: opts.name, phone: opts.phone });

  // Anchored to the 1st, three months back: the anchor day is never later than
  // today's date, so exactly four cycles are always due regardless of when this
  // test runs.
  const today = utcToday();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
  const secondCycle = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));

  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id,
      bed_id: bedId,
      rent_amount: opts.rent,
      deposit_amount: 0,
      rent_cycle: "monthly",
      start_date: isoDate(start),
    },
  });
  if (!stayRes.ok()) throw new Error(`createStay failed: ${await stayRes.text()}`);
  const stay = await stayRes.json();

  if (opts.paid > 0) {
    const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: opts.paid, payment_type: "cash", payment_date: isoDate(start) },
    });
    if (!payRes.ok()) throw new Error(`addPayment failed: ${await payRes.text()}`);
  }

  return { tenant, stay, start, secondCycle, today };
}

test.describe("Payments: who owes", () => {
  test("the board returns exact balance and overdue age", async ({ request }) => {
    const { token } = await createOwner(request, `coll-api-${RUN_ID}`);

    // ₹5,000/month, four cycles due (₹20,000), one month paid → ₹15,000 owed.
    const { tenant, start, secondCycle, today } = await seedOverdueStay(request, token, {
      name: `Collections Tenant ${RUN_ID}`,
      phone: `9${RUN_ID.slice(-9)}`,
      rent: 500000,
      paid: 500000,
    });

    const res = await request.get(`${BASE}/api/payments/board`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const rows = (await res.json()).stays;

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.tenant_id).toBe(tenant.id);
    expect(row.balance_paise).toBe(1500000);
    expect(row.rent_amount).toBe(500000);
    expect(row.rent_cycle).toBe("monthly");
    expect(row.bed_name).toBe("Bed A");
    expect(row.last_payment_date).toBe(isoDate(start));

    // One cycle is paid, so the debt runs from the start of the second cycle.
    expect(row.days_since_due).toBe(daysBetween(secondCycle, today));
    expect(row.due_state).toBe("overdue");
    expect(row.due_date).toBe(isoDate(secondCycle));
  });

  test("a tenant who is paid up owes nothing", async ({ request }) => {
    const { token } = await createOwner(request, `coll-paid-${RUN_ID}`);

    // Four cycles due, four cycles paid.
    await seedOverdueStay(request, token, {
      name: `Paid Up Tenant ${RUN_ID}`,
      phone: `8${RUN_ID.slice(-9)}`,
      rent: 500000,
      paid: 2000000,
    });

    const res = await request.get(`${BASE}/api/payments/board`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const [row] = (await res.json()).stays;
    expect(row.balance_paise).toBe(0);
    expect(row.due_state).not.toBe("overdue");
  });

  test("owner records a payment from the list and the row clears", async ({ page, request }) => {
    const { token } = await createOwner(request, `coll-ui-${RUN_ID}`);
    const name = `UI Collections ${RUN_ID}`;
    const phone = `7${RUN_ID.slice(-9)}`; // 10 digits → wa.me gets a 91 prefix
    await seedOverdueStay(request, token, { name, phone, rent: 500000, paid: 500000 });

    await loginAs(page, token);
    await page.goto("/payments");

    // The row, with the outstanding amount — not the rent, not the total billed.
    // (The seeded payment is also under "Recorded this week", entered today.)
    await expect(page.getByRole("link", { name }).first()).toBeVisible();
    await expect(page.getByText("₹15,000", { exact: true })).toBeVisible();

    // The nudge is a wa.me deep link, opened by the owner — never sent by us.
    const nudge = page.getByRole("link", { name: "Nudge" });
    const href = await nudge.getAttribute("href");
    expect(href).toContain(`https://wa.me/91${phone}?text=`);
    // The message the owner will see prefilled, with the outstanding amount
    // and the age of the debt in it.
    expect(decodeURIComponent(href!.split("?text=")[1])).toContain(
      "reminder that rent of ₹15,000 for Room 1 · Bed A is pending"
    );

    // Record the payment inline: the amount is prefilled with the whole balance.
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByLabel("Amount (₹)")).toHaveValue("15000");
    await page.getByRole("button", { name: "Save ₹15,000" }).click();

    // Debt cleared → off the overdue list, and listed as recorded instead.
    await expect(page.getByText(`Recorded ₹15,000 from UI`)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "Overdue" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Recorded this week" })).toContainText(name);
  });

  test("a tenant with an unusable phone offers a fix instead of a nudge", async ({ page, request }) => {
    const { token } = await createOwner(request, `coll-phone-${RUN_ID}`);
    const name = `Bad Phone ${RUN_ID}`;
    await seedOverdueStay(request, token, {
      name,
      phone: `69${RUN_ID.slice(-8)}`,
      rent: 500000,
      paid: 0,
    });

    // A number like this can no longer be saved (phone.go, Oct 2026), but
    // records from before the rule keep whatever was typed. The board is
    // given one, as such a record would come back.
    await page.route("**/api/payments/board", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      for (const row of json.stays) if (row.tenant_name === name) row.phone = "12345";
      await route.fulfill({ response: res, json });
    });

    await loginAs(page, token);
    await page.goto("/payments");

    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByRole("link", { name: "Nudge" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Fix phone" })).toBeVisible();
  });
});
