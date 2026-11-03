import { test, expect, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Someone given a bed from a later day — booked from the 10th, paid ₹500 to
 * hold it on the 3rd — read exactly like a tenant living there: a green Paid
 * tile, counted as occupied, and "Paid ₹500 of ₹0 expected" in the panel
 * (owner, 3 Nov 2026). Their bed now reads as arriving until that day.
 *
 *   Gita   in bed A from a week ahead, ₹500 paid  → arriving
 *   Hari   in bed B since last month              → lives here
 */

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

/** "10 Nov" — the tile's own short form. */
function short(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

const tile = (page: Page, first: string) => page.locator(`button[title^="${first} ${RUN_ID} —"]`);

test.describe("A bed whose tenant hasn't arrived", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("reads as arriving, not lived in and not paid", async ({ page, request }) => {
    const tag = `arr-${RUN_ID}`;
    const { token } = await createOwner(request, tag);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, tag);
    const bedB = await (await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name: "Bed B" } })).json();

    const stay = async (first: string, bed: number, start: string) => {
      const tenant = await createTenantViaApi(request, token, {
        name: `${first} ${RUN_ID}`, phone: `95${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
      });
      const res = await request.post(`${BASE}/api/stays`, {
        headers: auth,
        data: { tenant_id: tenant.id, bed_id: bed, rent_amount: 500000, deposit_amount: 200000, rent_cycle: "monthly", start_date: start },
      });
      expect(res.ok()).toBeTruthy();
      return res.json();
    };
    const arrives = utcDay(7);
    const gita = await stay("Gita", bedId, arrives);
    await stay("Hari", bedB.id, utcDay(-20));
    const paid = await request.post(`${BASE}/api/stays/${gita.id}/payments`, {
      headers: auth, data: { amount: 50000, payment_type: "online", payment_date: utcDay(0) },
    });
    expect(paid.ok()).toBeTruthy();

    const grid = await (await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth })).json();
    const statusOf = (name: string) => grid[0].beds.find((b: { name: string }) => b.name === name).status;
    expect(statusOf("Bed A")).toBe("arriving");
    expect(statusOf("Bed B")).not.toBe("arriving");

    // Taken but not lived in: neither occupied nor free.
    const dash = await (await request.get(`${BASE}/api/dashboard`, { headers: auth })).json();
    expect(dash.occupancy.occupied_beds).toBe(1);
    expect(dash.occupancy.arriving_beds).toBe(1);

    // Still one stay to a bed: nobody else can be put in it meanwhile.
    const other = await createTenantViaApi(request, token, { name: `Isha ${RUN_ID}`, phone: "9512345678" });
    const clash = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: other.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: utcDay(0) },
    });
    expect(clash.status()).toBe(409);

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);

    await expect(page.getByTestId("site-headcount")).toHaveText("1 tenant · 0 beds free · 1 arriving");
    await expect(page.getByText("1/2 occupied · 1 arriving")).toBeVisible();
    await expect(tile(page, "Gita")).toContainText(`arrives ${short(arrives)}`);
    await expect(tile(page, "Gita")).not.toContainText("due ");
    await expect(tile(page, "Gita")).toHaveAttribute("title", `Gita ${RUN_ID} — Arriving`);

    await tile(page, "Gita").click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Arriving", { exact: true })).toBeVisible();
    await expect(panel).toContainText(", in 7 days");
    await expect(panel.getByText("Paid before arriving")).toBeVisible();
    await expect(panel).toContainText("₹500");
    await expect(panel).toContainText(`Next rent ₹4,500 due ${short(arrives)}`);
    await expect(panel).not.toContainText("expected");

    // The tenant page says it too.
    await page.goto(`/tenants/${gita.tenant_id}`);
    await expect(page.getByText(/^Arrives /).first()).toBeVisible();
  });
});
