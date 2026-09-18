import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The grid's chips are bed statuses, and a status has a precedence: a notice
 * outranks arrears. So a tenant 70 days behind who had given notice was filed
 * under Vacating, and "Overdue 0" sat above ₹17,000 owed (UX audit M5). The
 * "Owes money" chip ignores status and asks only about the balance.
 *
 * Three tenants from the 1st of two months ago, so exactly three monthly
 * cycles are billed whatever day this runs:
 *   Asha   ₹5,000/mo, gave notice, paid nothing   → vacating, owes ₹15,000
 *   Bala   ₹3,000/mo, paid ₹9,000                  → paid, owes nothing
 *   Chitra ₹4,000/mo, paid nothing                 → overdue, owes ₹12,000
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

test.describe("The grid's Owes money filter", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test("finds the vacating tenant in arrears that the Overdue chip hides", async ({ page, request }) => {
    const { token } = await createOwner(request, `owes-${RUN_ID}`);
    const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `owes-${RUN_ID}`);
    const bedB = await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed B" });
    const bedC = await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed C" });

    const seed = async (first: string, phone: string, bed: number, rent: number) => {
      const t = await createTenantViaApi(request, token, { name: `${first} ${RUN_ID}`, phone: `${phone}${RUN_ID.slice(-8)}` });
      return post(request, token, "/api/stays", {
        tenant_id: t.id, bed_id: bed, rent_amount: rent, deposit_amount: 0,
        rent_cycle: "monthly", start_date: monthStart(-2),
      });
    };
    const asha = await seed("Asha", "81", bedId, 500000);
    const bala = await seed("Bala", "82", bedB.id, 300000);
    await seed("Chitra", "83", bedC.id, 400000);

    const notice = await request.put(`${BASE}/api/stays/${asha.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { notice_date: monthStart(-1) },
    });
    expect(notice.ok()).toBeTruthy();
    await post(request, token, `/api/stays/${bala.id}/payments`, {
      amount: 900000, payment_type: "cash", payment_date: monthStart(0),
    });

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);

    // The status chips, as before: Asha's debt is under Vacating.
    await expect(page.getByRole("button", { name: /^Overdue/ })).toContainText("1");
    await expect(page.getByRole("button", { name: /^Vacating/ })).toContainText("1");

    // Both debtors, and the whole of what they owe.
    const owes = page.getByRole("button", { name: /^Owes money/ });
    await expect(owes).toHaveText(/Owes money\s*2\s*·\s*₹27,000/);

    await owes.tap();
    await expect(owes).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Asha", { exact: true })).toBeVisible();
    await expect(page.getByText("Chitra", { exact: true })).toBeVisible();
    await expect(page.getByText("Bala", { exact: true })).toHaveCount(0);

    // Tapping again goes back to everyone.
    await owes.tap();
    await expect(page.getByText("Bala", { exact: true })).toBeVisible();
  });

  test("says so when nobody owes anything", async ({ page, request }) => {
    const { token } = await createOwner(request, `owes-none-${RUN_ID}`);
    const { siteId } = await createSiteRoomBed(request, token, `owes-none-${RUN_ID}`);

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);
    await page.getByRole("button", { name: /^Owes money/ }).tap();
    await expect(page.getByText("Nobody at this site owes money.")).toBeVisible();
  });
});
