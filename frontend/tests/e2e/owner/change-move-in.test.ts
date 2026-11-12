import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Someone written down as moving in on the 10th whose month really runs from
 * the 15th (owner, 12 Nov 2026). The server always took a new start_date; no
 * screen offered it once they had a bed. The date on the stay card is now
 * the control, and moving it moves the rent day.
 *
 *   Jaya   in bed A from 2 days ago, ₹1,000 paid  → moved to 3 days ahead
 *   Kiran  in bed B, moved to bed C yesterday    → can't start after the move
 */

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

/** "15th", as the dialog's hint words the rent day. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

test.describe("Changing a stay's move-in date", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("moves the rent day from the stay card", async ({ page, request }) => {
    const tag = `movein-${RUN_ID}`;
    const { token } = await createOwner(request, tag);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, bedId } = await createSiteRoomBed(request, token, tag);

    const tenant = await createTenantViaApi(request, token, { name: `Jaya ${RUN_ID}`, phone: "9587654321" });
    const res = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: utcDay(-2) },
    });
    expect(res.ok()).toBeTruthy();
    const stay = await res.json();
    const paid = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth, data: { amount: 100000, payment_type: "cash", payment_date: utcDay(-2) },
    });
    expect(paid.ok()).toBeTruthy();

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    await page.getByRole("button", { name: /^Change move-in date/ }).click();
    const dialog = page.getByRole("dialog", { name: "Change move-in date" });
    await expect(dialog).toBeVisible();

    const moveTo = utcDay(3);
    await dialog.locator('input[type="date"]').fill(moveTo);
    // What it will mean, before saving: the rent day, and the bed reads
    // arriving because the day is still to come.
    await expect(dialog).toContainText(`Rent falls due on the ${ordinal(Number(moveTo.slice(8, 10)))} of each month`);
    await expect(dialog).toContainText("Until then the bed reads arriving.");

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/^Moved in /)).toBeVisible();

    const after = await (await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth })).json();
    expect(after.start_date.slice(0, 10)).toBe(moveTo);

    const grid = await (await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth })).json();
    const bed = grid[0].beds.find((b: { id: number }) => b.id === bedId);
    expect(bed.status).toBe("arriving");

    // The payment still counts: nothing is owed before the new move-in day.
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth })).json();
    expect(summary.total_paid).toBe(100000);
    expect(summary.balance).toBeLessThanOrEqual(0);
  });

  test("refuses a move-in date after a bed move", async ({ request }) => {
    const tag = `movein-mv-${RUN_ID}`;
    const { token } = await createOwner(request, tag);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, tag);
    const bedC = await (await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name: "Bed C" } })).json();

    const tenant = await createTenantViaApi(request, token, { name: `Kiran ${RUN_ID}`, phone: "9576543210" });
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: utcDay(-10) },
    })).json();
    const moved = await request.post(`${BASE}/api/stays/${stay.id}/move`, {
      headers: auth, data: { bed_id: bedC.id, moved_on: utcDay(-1) },
    });
    expect(moved.ok()).toBeTruthy();

    const late = await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { start_date: utcDay(0) } });
    expect(late.status()).toBe(400);
    expect((await late.json()).error).toContain("changed beds before that date");

    // On or before the move is fine, and so is moving it earlier.
    const onMove = await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { start_date: utcDay(-1) } });
    expect(onMove.ok()).toBeTruthy();
    const earlier = await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: { start_date: utcDay(-20) } });
    expect(earlier.ok()).toBeTruthy();
  });
});
