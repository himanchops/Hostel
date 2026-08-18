import { test, expect, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

const PHONE_VIEWPORT = { width: 375, height: 812 };   // iPhone X-ish, the floor we support
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

/** Horizontal scroll on a phone is the failure this whole phase exists to prevent. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Content clipped inside a container is invisible in a screenshot but just as
 * broken — the pending page's Approve buttons were sitting on top of the
 * tenant's email this way.
 */
async function clippedInsideMain(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["no <main>"];
    const bad: string[] = [];
    main.querySelectorAll("*").forEach((el) => {
      const style = getComputedStyle(el);
      if (
        el.scrollWidth > el.clientWidth + 2 &&
        el.clientWidth > 0 &&
        style.overflowX === "visible"
      ) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
      }
    });
    return bad;
  });
}

test.describe("Responsive shell", () => {
  let token: string;
  let siteId: number;

  test.beforeAll(async ({ request }) => {
    const owner = await createOwner(request, `resp-${RUN_ID}`);
    token = owner.token;

    const seeded = await createSiteRoomBed(request, token, RUN_ID);
    siteId = seeded.siteId;

    // A tenant who owes money, so /collections has rows to lay out rather than
    // an empty state — the empty state fits anywhere.
    const tenant = await createTenantViaApi(request, token, {
      name: `Responsive Tenant ${RUN_ID}`,
      phone: `9${RUN_ID.slice(-9)}`,
      email: "a-fairly-long-address@example.com",
    });
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
    await request.post(`${BASE}/api/stays`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        tenant_id: tenant.id,
        bed_id: seeded.bedId,
        rent_amount: 500000,
        deposit_amount: 0,
        rent_cycle: "monthly",
        start_date: start.toISOString().slice(0, 10),
      },
    });
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, token);
  });

  test("every page fits a 375px phone with nothing clipped", async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);

    const paths = [
      "/dashboard",
      "/collections",
      "/sites",
      `/sites/${siteId}`,
      `/sites/${siteId}/grid`,
      "/tenants",
      "/tenants/new",
      "/pending",
    ];

    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      expect(await horizontalOverflow(page), `${path} scrolls sideways at 375px`).toBe(0);
      expect(await clippedInsideMain(page), `${path} has clipped content`).toEqual([]);
    }
  });

  test("phone gets the tab bar, desktop gets the sidebar", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });

    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/dashboard");
    // Exactly one nav is in the accessibility tree at a time; on a phone it is
    // the fixed bottom bar.
    await expect(nav).toHaveCount(1);
    const phoneBox = await nav.boundingBox();
    expect(phoneBox!.y).toBeGreaterThan(PHONE_VIEWPORT.height / 2); // pinned to the bottom
    expect(Math.round(phoneBox!.width)).toBe(PHONE_VIEWPORT.width); // full width
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(nav).toHaveCount(1);
    const desktopBox = await nav.boundingBox();
    expect(desktopBox!.y).toBeLessThan(DESKTOP_VIEWPORT.height / 2); // runs down the left
    expect(desktopBox!.width).toBeLessThan(300);
    // Sign out lives in the sidebar on desktop, behind the avatar menu on phones.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toBeHidden();
  });

  test("the tab bar navigates and marks the current section", async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("link", { name: "Collections" }).click();

    await expect(page).toHaveURL(/\/collections$/);
    await expect(nav.getByRole("link", { name: "Collections" })).toHaveAttribute("aria-current", "page");
    // The page's own heading is still the one naming the page.
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
  });

  test("the account menu opens and signs out from a phone", async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/dashboard");

    await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
    await page.getByRole("button", { name: "Account menu" }).click();

    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await signOut.click();

    await expect(page).toHaveURL(/\/login$/);
  });
});
