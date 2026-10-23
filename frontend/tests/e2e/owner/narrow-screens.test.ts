import { test, expect, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `narrow-${Date.now()}`;

/**
 * Real amounts are wide. The responsive suite seeds ₹5,000 rents, which fit
 * anywhere; the owner saw a six-figure "Rent paid" run out of its tile into
 * the next one on a phone. This seeds the widest figures a 45-bed hostel
 * really produces — ten-lakh totals, "₹10,50,000", as a year of Insights
 * reaches — and measures every screen they appear on, at every width the app
 * is used at.
 */
const VIEWPORTS = [
  { name: "a phone", viewport: { width: 375, height: 812 } },
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
  { name: "an iPad in landscape", viewport: { width: 1024, height: 768 } },
];

/** Any element whose content is wider than itself and spills out visibly. */
async function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["no <main>"];
    const bad: string[] = [];
    main.querySelectorAll("*").forEach((el) => {
      const style = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && style.overflowX === "visible") {
        bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`);
      }
    });
    return bad;
  });
}

let token = "";
let tenantId = 0;

test.beforeAll(async ({ request }) => {
  const owner = await createOwner(request, RUN_ID);
  token = owner.token;
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, RUN_ID);
  const tenant = await createTenantViaApi(request, token, { name: "Siddharth Kulkarni", phone: "9811122233" });
  tenantId = tenant.id;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 2_10_000_00, deposit_amount: 1_00_000_00,
      rent_cycle: "monthly", start_date: start.toISOString().slice(0, 10),
    },
  })).json();
  for (const data of [
    // ₹10,50,000 of rent (five months) against six billed: ₹2,10,000 owed.
    { amount: 1_00_000_00, kind: "deposit", payment_type: "cash" },
    { amount: 10_50_000_00, payment_type: "online" },
  ]) {
    const res = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: auth, data: { ...data, payment_date: start.toISOString().slice(0, 10) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`Wide amounts on ${name}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("nothing spills out of its box", async ({ page }) => {
      await loginAs(page, token);
      for (const path of [`/tenants/${tenantId}`, "/dashboard", "/payments", "/insights", "/tenants"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await spills(page), `${path} at ${viewport.width}px`).toEqual([]);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(sideways, `${path} scrolls sideways at ${viewport.width}px`).toBe(0);
      }
    });

    test("a tenant opens from anywhere on their row", async ({ page }) => {
      await loginAs(page, token);
      await page.goto("/tenants");
      // Their phone number, not their name or a "View" link: the whole row is
      // the target. (A phone shows the number under the name, wider screens
      // in a column of its own; tap whichever is showing.)
      await page.locator("text=9811122233 >> visible=true").first().tap();
      await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}$`));
    });
  });
}
