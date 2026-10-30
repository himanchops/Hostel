import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Controls that hide until their row is hovered (UX audit B2).
 *
 * Deleting a payment, like deleting a site, was `hidden … group-hover:block`:
 * display:none on every touchscreen and unreachable by keyboard. Phase 16's
 * replacement keyed off screen WIDTH, which left the controls invisible on an
 * iPad, the device this app is mostly used on. tests/unit/hover-reveal.test.ts
 * stops the pattern coming back in source; this checks what a finger and a
 * mouse actually get. A payment is now opened by its row, with a chevron that
 * is always on show, and deleted from the sheet that opens (Oct 2026).
 */

function monthStart(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

/** A tenant in Bed A with one ₹7,500 payment — something to delete on every screen. */
async function seed(request: APIRequestContext, suffix: string) {
  const { token } = await createOwner(request, `reveal-${suffix}-${RUN_ID}`);
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${suffix}`);
  const firstName = `Reveal${suffix}`;
  const tenant = await createTenantViaApi(request, token, {
    name: `${firstName} Tenant`,
    phone: `96${RUN_ID.slice(-5)}${String(suffix.length).padStart(3, "0")}`,
  });
  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 750000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(0),
    },
  });
  expect(stayRes.ok()).toBeTruthy();
  const stay = await stayRes.json();
  const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
    headers: auth,
    data: { amount: 750000, payment_type: "cash", payment_date: monthStart(0) },
  });
  expect(payRes.ok()).toBeTruthy();
  return { token, siteId, tenantId: tenant.id, firstName };
}

/** Playwright's toBeVisible() counts opacity:0 as visible — so ask for the opacity. */
async function expectShown(control: Locator) {
  await expect(control).toHaveCSS("opacity", "1");
}

async function pointer(page: Page) {
  return page.evaluate(() => ({
    fine: matchMedia("(pointer: fine)").matches,
    hover: matchMedia("(hover: hover)").matches,
  }));
}

const TOUCH = [
  { name: "a phone", viewport: { width: 375, height: 812 } },
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
  { name: "an iPad in landscape", viewport: { width: 1024, height: 768 } },
];

for (const device of TOUCH) {
  test.describe(`on ${device.name}, by touch`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test("delete site, bed controls and delete payment are all on show and answer a tap", async ({ page, request }) => {
      const s = await seed(request, `t${device.viewport.width}`);
      await loginAs(page, s.token);
      await page.goto("/sites");

      // The premise, checked rather than assumed: no fine pointer, no hover —
      // what a finger on glass reports. Without this the rest proves nothing.
      expect(await pointer(page)).toEqual({ fine: false, hover: false });

      // The seeded site has a stay, so its control explains rather than
      // deletes (delete-guard.test.ts); reachable either way is the point.
      const deleteSite = page.getByRole("button", { name: /^Why site .* cannot be deleted/ });
      await expectShown(deleteSite);
      await deleteSite.tap();
      const confirmDelete = page.getByRole("dialog");
      await expect(confirmDelete).toBeVisible();
      await confirmDelete.getByRole("button", { name: "OK" }).tap();
      await expect(confirmDelete).toHaveCount(0);

      // The one Phase 16 had already "fixed" — invisible here until now.
      await page.goto(`/sites/${s.siteId}`);
      await page.getByRole("button", { name: /^Room 1/ }).tap(); // beds live inside the room
      const chip = page.locator('[data-testid="bed-chip"]').filter({ hasText: "Bed A" });
      await expectShown(chip.getByRole("button", { name: "Rename bed Bed A" }));
      await expectShown(chip.getByRole("button", { name: /bed Bed A/ }).last());

      // A payment opens from its row; Delete is inside.
      await page.goto(`/tenants/${s.tenantId}`);
      const openPayment = page.getByRole("button", { name: /^Open payment of ₹7,500/ });
      await expectShown(openPayment);
      await openPayment.tap();
      await page.getByRole("dialog").getByRole("button", { name: "Delete…" }).tap();
      await page.getByRole("dialog").filter({ hasText: "Use this when the money never came" })
        .getByRole("button", { name: "Delete" }).tap();
      await expect(page.getByText("Payment deleted")).toBeVisible();
      await expect(openPayment).toHaveCount(0);
    });

    test("the grid drawer's payments are on show and answer a tap", async ({ page, request }) => {
      const s = await seed(request, `g${device.viewport.width}`);
      await loginAs(page, s.token);
      await page.goto(`/sites/${s.siteId}/grid`);

      await page.getByRole("button", { name: new RegExp(s.firstName) }).tap();
      const drawer = page.getByRole("dialog");
      const openPayment = drawer.getByRole("button", { name: /^Open payment of ₹7,500/ });
      await expectShown(openPayment);

      await openPayment.tap();
      await page.getByRole("dialog").filter({ hasText: "Entered by" })
        .getByRole("button", { name: "Delete…" }).tap();
      await page.getByRole("dialog").filter({ hasText: "Use this when the money never came" })
        .getByRole("button", { name: "Delete" }).tap();
      await expect(page.getByText("Payment deleted")).toBeVisible();
      await expect(openPayment).toHaveCount(0);
    });
  });
}

test.describe("with a mouse", () => {
  test("controls stay tucked away until the row is hovered, and the keyboard can reach them", async ({ page, request }) => {
    const s = await seed(request, "mouse");
    await loginAs(page, s.token);
    await page.goto("/sites");
    expect(await pointer(page)).toEqual({ fine: true, hover: true });

    const deleteSite = page.getByRole("button", { name: /^Why site .* cannot be deleted/ });
    await expect(deleteSite).toHaveCSS("opacity", "0");

    await deleteSite.locator("..").hover(); // the site's card
    await expectShown(deleteSite);

    await page.mouse.move(0, 0);
    await expect(deleteSite).toHaveCSS("opacity", "0");

    // The old display:none control could not be focused at all.
    await deleteSite.focus();
    await expect(deleteSite).toBeFocused();
    await expectShown(deleteSite);

    // A payment's control is not tucked away at all: correcting money is
    // opened from the row, and the chevron is there for a keyboard.
    await page.goto(`/tenants/${s.tenantId}`);
    await expectShown(page.getByRole("button", { name: /^Open payment of ₹7,500/ }));
  });
});
