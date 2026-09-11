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

    // Hovering a bar must give the EXACT figure, not the compact axis form —
    // the entire reason to hover is to stop estimating from bar heights.
    await page.getByRole("img", { name: /Collected against Billed by month/i })
      .locator("rect[fill='transparent']").last().hover();
    await expect(page.getByText("₹8,000", { exact: true }).first()).toBeVisible();

    // "By room" is shut by default, and its summary has to be worth reading
    // shut — it names the room earning nothing without being opened.
    const byRoom = page.getByRole("button", { name: /By room/ });
    await expect(byRoom).toHaveAttribute("aria-expanded", "false");
    await expect(byRoom).toContainText("never let");

    await byRoom.click();
    await expect(byRoom).toHaveAttribute("aria-expanded", "true");

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

  test("occupancy folds away and unmounts its chart", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-fold`);
    await loginAs(page, token);
    await page.goto("/insights");

    const occupancy = page.getByRole("button", { name: /Occupancy/ });
    await expect(occupancy).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("img", { name: /Occupancy by month/i })).toBeVisible();

    // Folded content is unmounted, not just hidden — a chart left measuring a
    // zero-width container caches a broken layout.
    await occupancy.click();
    await expect(occupancy).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("img", { name: /Occupancy by month/i })).toHaveCount(0);

    await occupancy.click();
    await expect(page.getByRole("img", { name: /Occupancy by month/i })).toBeVisible();
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

  /**
   * This used to be one test at 375px asserting only that the PAGE never
   * scrolled sideways — which <main>'s overflow-x-hidden guarantees by
   * clipping, so it passed for exactly the reason the bug existed (UX audit
   * M2). It also ran against an owner with no data and never drew a chart.
   *
   * Now: a year of data, so the chart takes its natural 12 × 56 = 672px, and
   * the assertion is the one the owner cares about — the chart sits inside the
   * screen, and scrolling it brings the most recent month into view.
   */
  for (const vp of [
    { name: "a 375px phone", width: 375, height: 812 },
    { name: "an iPad in portrait", width: 768, height: 1024 },
    { name: "an iPad in landscape", width: 1024, height: 768 },
  ]) {
    test(`every month of the chart can be reached on ${vp.name}`, async ({ page, request }) => {
      const { token } = await seedYear(request, `${RUN_ID}-vp${vp.width}`);
      await loginAs(page, token);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/insights");

      const chart = page.getByRole("img", { name: /Collected against Billed by month/i });
      await expect(chart).toBeVisible();
      const scroller = chart.locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]");

      const box = await scroller.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      // The scroller is inside the screen, not drawn past its edge.
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(vp.width);

      if (vp.width < 672) {
        // Too narrow for twelve months, so it must actually scroll. Before the
        // fix the scroller grew to fit the chart and had nothing to scroll.
        expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
      }

      // Scrolled to the end, this month's bar is on screen.
      await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      const last = await chart.locator("rect[fill='transparent']").last().boundingBox();
      expect(last!.x).toBeGreaterThanOrEqual(box.left - 1);
      expect(last!.x + last!.width).toBeLessThanOrEqual(box.right + 1);

      // Still true, still worth keeping — just no longer the only check.
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )).toBeLessThanOrEqual(1);

      if (vp.width < 1024) {
        // Reachable from the bottom tab bar, not buried in a menu.
        await expect(
          page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Insights" }),
        ).toBeVisible();
      }
    });
  }
});

/** A tenant in since the 1st, eleven months back, paying ₹8,000 on every 1st since — twelve months with a bar. */
async function seedYear(request: import("@playwright/test").APIRequestContext, runId: string) {
  const { token } = await createOwner(request, runId);
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, runId);
  const tenant = await createTenantViaApi(request, token, {
    name: "Year Tenant",
    phone: `97${runId.replace(/\D/g, "").slice(-8)}`,
  });

  const today = utcToday();
  const monthStart = (offset: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));

  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 800000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: isoDate(monthStart(-11)),
    },
  });
  expect(stayRes.ok()).toBeTruthy();
  const stay = await stayRes.json();

  for (let m = -11; m <= 0; m++) {
    const pay = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth,
      data: { amount: 800000, payment_type: "online", payment_date: isoDate(monthStart(m)) },
    });
    expect(pay.ok()).toBeTruthy();
  }
  return { token };
}
