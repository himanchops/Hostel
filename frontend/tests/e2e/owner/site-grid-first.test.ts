import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Owner feedback, 24 Oct 2026, from running the real hostel:
 * - a site opens on its grid, because assigning beds is the everyday job and
 *   laying out rooms is occasional ("Edit rooms" is a button there)
 * - with one site, the Sites tab goes straight to that grid, and the list,
 *   where a second site is added, is one tap away through the breadcrumb
 * - the grid says how many people live there
 * - no screen asks for or shows a tenant's email
 * - a slow load shows beds filling in, and says the server is waking up
 */

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

test.describe("A site opens on its grid", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test("the Sites tab opens the only site's grid, which counts its tenants", async ({ page, request }) => {
    const { token } = await createOwner(request, `gridfirst-${RUN_ID}`);
    const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `gridfirst-${RUN_ID}`);
    await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed B" });
    await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed C" });
    const t = await createTenantViaApi(request, token, { name: `Kiran ${RUN_ID}`, phone: `91${RUN_ID.slice(-8)}` });
    await post(request, token, "/api/stays", {
      tenant_id: t.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: new Date().toISOString().slice(0, 10),
    });

    await loginAs(page, token);
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Sites" }).click();
    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/grid$`));

    // One tenant in three beds.
    await expect(page.getByTestId("site-headcount")).toHaveText("1 tenant · 2 beds free");
    await expect(page.getByRole("heading", { name: `E2E Site gridfirst-${RUN_ID}` })).toBeVisible();

    // Edit rooms is a button off the grid, and it comes back.
    await page.getByRole("link", { name: "Edit rooms" }).click();
    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));
    await page.getByRole("link", { name: "Back to the grid" }).click();
    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/grid$`));

    // The list, and adding a second site, are one tap away.
    await page.getByRole("main").getByRole("link", { name: "Sites", exact: true }).click();
    await expect(page).toHaveURL(/\/sites$/);
    await expect(page.getByRole("button", { name: "+ Add site" })).toBeVisible();
  });

  test("a new site, with no rooms yet, opens on room setup", async ({ page, request }) => {
    const { token } = await createOwner(request, `emptysite-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto("/sites");
    await page.getByRole("button", { name: "+ Add site" }).first().click();
    await page.getByPlaceholder(/name/i).first().fill(`Annexe ${RUN_ID}`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/sites\/\d+$/);
    await expect(page.getByRole("button", { name: "+ Add room" }).first()).toBeVisible();
    // No grid link while there is nothing for the grid to show.
    await expect(page.getByRole("link", { name: "Back to the grid" })).toHaveCount(0);

    // And its grid, opened directly, sends it back here.
    const siteId = page.url().match(/\/sites\/(\d+)$/)![1];
    await page.goto(`/sites/${siteId}/grid`);
    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`));
  });

  test("with two sites, the Sites tab opens the list", async ({ page, request }) => {
    const { token } = await createOwner(request, `twosites-${RUN_ID}`);
    await createSiteRoomBed(request, token, `twosites-a-${RUN_ID}`);
    await createSiteRoomBed(request, token, `twosites-b-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Sites" }).click();
    await expect(page).toHaveURL(/\/sites$/);
    await page.getByRole("link", { name: new RegExp(`E2E Site twosites-a-${RUN_ID}`) }).click();
    await expect(page).toHaveURL(/\/sites\/\d+\/grid$/);
  });
});

test.describe("No screen asks for a tenant's email", () => {
  test("Add tenant, the tenant page and the list have no email", async ({ page, request }) => {
    const { token } = await createOwner(request, `noemail-${RUN_ID}`);
    const t = await createTenantViaApi(request, token, { name: `Meera ${RUN_ID}`, phone: `92${RUN_ID.slice(-8)}` });
    await loginAs(page, token);

    await page.goto("/tenants/new");
    await expect(page.getByRole("textbox", { name: /^Phone/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);

    await page.goto("/tenants");
    await expect(page.getByText(`Meera ${RUN_ID}`)).toBeVisible();
    // The owner's own address in the account menu is theirs, not a tenant's.
    await expect(page.getByRole("main").getByText(/email/i)).toHaveCount(0);

    await page.goto(`/tenants/${t.id}`);
    await page.getByRole("button", { name: /^Edit/ }).first().click();
    await expect(page.getByRole("textbox", { name: /^Phone/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  });
});

test.describe("Loading", () => {
  test("a slow load shows the beds and says the server is waking up", async ({ page, request }) => {
    const { token } = await createOwner(request, `slow-${RUN_ID}`);
    const { siteId } = await createSiteRoomBed(request, token, `slow-${RUN_ID}`);
    await loginAs(page, token);
    // A cold Render instance, played by a grid request that takes 7 seconds.
    await page.route(`**/api/sites/${siteId}/grid`, async (route) => {
      await new Promise((r) => setTimeout(r, 7000));
      await route.continue();
    });
    await page.goto(`/sites/${siteId}/grid`);
    const loader = page.getByRole("status").filter({ hasText: "Loading" });
    await expect(loader).toBeVisible();
    await expect(page.getByText("Waking the server up…")).toBeVisible({ timeout: 6500 });
    await expect(page.getByTestId("site-headcount")).toBeVisible({ timeout: 10000 });
    await expect(loader).toHaveCount(0);
  });

  test("a warm load never shows it", async ({ page, request }) => {
    const { token } = await createOwner(request, `warm-${RUN_ID}`);
    const { siteId } = await createSiteRoomBed(request, token, `warm-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);
    await expect(page.getByTestId("site-headcount")).toBeVisible();
    // It was in the page for a moment, but held at opacity 0 for the first
    // 800ms, so nobody saw it. Check it is gone rather than timing a fade.
    await expect(page.getByText("Waking the server up…")).toHaveCount(0);
  });
});
