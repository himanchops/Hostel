import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `ins-${Date.now()}`;

/**
 * UTC for the same reason collections.test.ts is: the backend takes "today" as
 * UTC midnight, and local dates disagree with it either side of midnight.
 */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

test.describe("Insights", () => {
  test("shows a full-house room and a never-let room side by side", async ({ page, request }) => {
    const { token } = await createOwner(request, RUN_ID);
    const auth = { Authorization: `Bearer ${token}` };

    // Room A gets a tenant who has been in since the 1st of two months ago and
    // has paid every cycle. Room B is created and then left empty — the
    // contrast is the whole point of the table.
    const roomA = await createSiteRoomBed(request, token, `${RUN_ID}-a`);

    const roomBRes = await request.post(`${BASE}/api/sites/${roomA.siteId}/rooms`, {
      headers: auth,
      data: { name: "Empty Room", floor: 0 },
    });
    expect(roomBRes.ok()).toBeTruthy();
    const roomB = await roomBRes.json();
    const bedRes = await request.post(
      `${BASE}/api/sites/${roomA.siteId}/rooms/${roomB.id}/beds`,
      { headers: auth, data: { name: "1L" } },
    );
    expect(bedRes.ok()).toBeTruthy();

    const tenant = await createTenantViaApi(request, token, {
      name: "Insight Tenant",
      phone: "9845220001",
    });

    // Anchored to the 1st two months back, so the cycle count never depends on
    // what day of the month this test happens to run.
    const today = utcToday();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));

    const stayRes = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: {
        tenant_id: tenant.id,
        bed_id: roomA.bedId,
        rent_amount: 800000,
        deposit_amount: 0,
        rent_cycle: "monthly",
        start_date: isoDate(start),
      },
    });
    expect(stayRes.ok()).toBeTruthy();
    const stay = await stayRes.json();

    const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 800000, payment_type: "cash", payment_date: isoDate(start) },
    });
    expect(payRes.ok()).toBeTruthy();

    await loginAs(page, token);
    await page.goto("/insights");

    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();

    // Both charts render.
    await expect(page.getByRole("img", { name: /Collected against Billed by month/i })).toBeVisible();
    await expect(page.getByRole("img", { name: /Occupancy by month/i })).toBeVisible();

    // The occupied room and the empty one both appear — an empty room must not
    // be silently dropped, because "earning nothing" is the finding.
    const occupied = page.getByRole("row", { name: /Room 1\b/ });
    const empty = page.getByRole("row", { name: /Empty Room/ });
    await expect(occupied).toBeVisible();
    await expect(empty).toBeVisible();

    // The let room collected money; the empty one collected nothing.
    await expect(occupied).toContainText("₹8,000");
    await expect(empty).toContainText("₹0");
    await expect(empty).toContainText("0%");
  });

  test("range picker refetches and narrows the window", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-range`);
    await loginAs(page, token);
    await page.goto("/insights");

    const twelve = await page.getByText(/^\d{4}-\d{2}-\d{2} to /).textContent();

    await page.getByRole("button", { name: "3m" }).click();
    await expect(page.getByRole("button", { name: "3m" })).toHaveAttribute("aria-pressed", "true");

    // The subtitle carries the window, so a shorter range must move from_date
    // forward rather than silently rendering the same twelve months.
    await expect(page.getByText(/^\d{4}-\d{2}-\d{2} to /)).not.toHaveText(twelve ?? "");
  });

  test("works at 375px with the charts scrolling, not the page", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-mobile`);
    await loginAs(page, token);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/insights");

    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();

    // Insights is reachable from the bottom tab bar, not buried in a menu.
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Insights" }),
    ).toBeVisible();

    // The page itself must never scroll sideways — wide charts scroll inside
    // their own container.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
