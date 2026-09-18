import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

const RUN_ID = Date.now().toString();

/**
 * `/tenants/new` said "No sites yet. Add a site with rooms and beds first."
 * for the three seconds its sites request took — confident, actionable and
 * wrong, to an owner with two sites (UX audit M11). A failed request said the
 * same thing forever. Loading, empty and failed are now three answers.
 */
test.describe("The bed picker on the new-tenant form", () => {
  test("says it is loading, not that there are no sites", async ({ page, request }) => {
    const { token } = await createOwner(request, `picker-a-${RUN_ID}`);
    await createSiteRoomBed(request, token, `picker-a-${RUN_ID}`);

    // Hold the sites response until the loading state has been checked.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route("**/api/sites", async (route) => {
      await held;
      await route.continue();
    });

    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel("Place them in a bed now").check();

    await expect(page.getByText("Loading your sites…")).toBeVisible();
    await expect(page.getByText(/No sites yet/)).toHaveCount(0);

    release();
    await expect(page.getByRole("radio", { name: "Room 1 · Bed A" })).toBeVisible();
    await expect(page.getByText(/No sites yet/)).toHaveCount(0);
  });

  test("says so when the sites cannot be loaded", async ({ page, request }) => {
    const { token } = await createOwner(request, `picker-b-${RUN_ID}`);
    await page.route("**/api/sites", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "failed to fetch sites" }) }),
    );

    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel("Place them in a bed now").check();

    await expect(page.getByText(/reload the page to try again/)).toBeVisible();
    await expect(page.getByText(/No sites yet/)).toHaveCount(0);
  });

  test("still says there are no sites when there are none", async ({ page, request }) => {
    const { token } = await createOwner(request, `picker-c-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel("Place them in a bed now").check();
    await expect(page.getByText(/No sites yet/)).toBeVisible();
  });
});
