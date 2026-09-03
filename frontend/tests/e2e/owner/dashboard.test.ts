import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `dash-${Date.now()}`;

/**
 * UTC for the same reason collections.test.ts is: the backend takes "today" as
 * time.Now().Truncate(24h), which is UTC midnight.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A tenant in a bed, on a stay anchored to the 1st two months back. */
async function seedStay(
  request: APIRequestContext,
  token: string,
  suffix: string,
  name: string,
  phone: string,
) {
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${suffix}`);
  const tenant = await createTenantViaApi(request, token, { name, phone });

  const today = utcToday();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));

  const res = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id,
      bed_id: bedId,
      rent_amount: 800000,
      deposit_amount: 0,
      rent_cycle: "monthly",
      start_date: isoDate(start),
    },
  });
  if (!res.ok()) throw new Error(`createStay failed: ${await res.text()}`);
  return { tenant, stay: await res.json(), start };
}

test.describe("Owner dashboard", () => {
  test("a tenant who gave notice links through to their profile", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-notice`);
    const { tenant, stay } = await seedStay(request, token, "notice", "Notice Giver", "9845330001");

    // notice_date alone — PUT /api/stays/:id is a true partial patch, so this
    // leaves the rest of the stay untouched.
    const res = await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { notice_date: isoDate(utcToday()) },
    });
    expect(res.ok()).toBeTruthy();

    await loginAs(page, token);
    await page.goto("/dashboard");

    await page.getByText("Notice Giver").click();

    await expect(page).toHaveURL(new RegExp(`/tenants/${tenant.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Notice Giver");
  });

  test("a payment row links to the tenant, not to the payment id", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-pay`);
    const { tenant, stay, start } = await seedStay(request, token, "pay", "Payer Person", "9845330002");

    const res = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { amount: 800000, payment_type: "cash", payment_date: isoDate(start) },
    });
    expect(res.ok()).toBeTruthy();
    const payment = await res.json();

    await loginAs(page, token);
    await page.goto("/dashboard");

    // The href must carry the TENANT id. `id` on the payment row is the
    // payment's own id and sits right next to `tenant_id` in the payload — this
    // asserts the wrong one was not picked.
    const row = page.getByRole("link", { name: /Payer Person/ });
    await expect(row).toHaveAttribute("href", `/tenants/${tenant.id}`);
    if (payment.id !== tenant.id) {
      await expect(row).not.toHaveAttribute("href", `/tenants/${payment.id}`);
    }

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/tenants/${tenant.id}$`));
  });

  test("the vacating empty state describes what the query actually does", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-empty`);
    // An active stay with no notice. The old copy promised a 30-day window that
    // the query never implemented — the predicate is notice_date, nothing else.
    await seedStay(request, token, "empty", "Staying Put", "9845330003");

    await loginAs(page, token);
    await page.goto("/dashboard");

    await expect(page.getByText("No one has given notice.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Staying Put/ })).toHaveCount(0);
  });

  test("a long list shows five, then all of them", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-peek`);
    const { stay, start } = await seedStay(request, token, "peek", "Frequent Payer", "9845330004");

    // Seven payments on distinct dates, so ORDER BY payment_date is stable.
    for (let i = 0; i < 7; i++) {
      const when = new Date(start.getTime() + i * 86_400_000);
      const res = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { amount: 100000, payment_type: "cash", payment_date: isoDate(when) },
      });
      expect(res.ok()).toBeTruthy();
    }

    await loginAs(page, token);
    await page.goto("/dashboard");

    const rows = page.getByRole("link", { name: /Frequent Payer/ });
    await expect(rows).toHaveCount(5);

    const showAll = page.getByRole("button", { name: "Show all 7" });
    await expect(showAll).toHaveAttribute("aria-expanded", "false");
    await showAll.click();

    await expect(rows).toHaveCount(7);
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();

    // Seven is under the server's cap of ten, so nothing was truncated and the
    // "only the N most recent" line must stay away.
    await expect(page.getByText(/Only the .* are shown/)).toHaveCount(0);
  });

  test("a short card does not stretch to match a tall one", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-stretch`);
    const { stay, start } = await seedStay(request, token, "stretch", "Tall Card", "9845330005");

    for (let i = 0; i < 4; i++) {
      const when = new Date(start.getTime() + i * 86_400_000);
      await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { amount: 100000, payment_type: "cash", payment_date: isoDate(when) },
      });
    }

    await loginAs(page, token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");

    const vacating = page.locator("div.rounded-xl").filter({ hasText: "Vacating Soon" }).first();
    const payments = page.locator("div.rounded-xl").filter({ hasText: "Recent Payments" }).first();

    const a = await vacating.boundingBox();
    const b = await payments.boundingBox();

    // Four payment rows against an empty vacating card. Without lg:items-start
    // the grid stretches both to the taller track and these are equal.
    expect(a!.height).toBeLessThan(b!.height);
  });
});
