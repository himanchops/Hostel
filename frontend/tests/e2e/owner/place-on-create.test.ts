import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `place-${Date.now()}`;

/**
 * Before this, `/tenants/new` created a *person* and nothing about where they
 * would sleep: the only `staysApi.create` call site in the whole frontend was
 * the grid. Adding a tenant meant filling the form, then walking Sites → site →
 * room → bed → assign.
 */
test.describe("Placing a tenant while creating them", () => {
  test("creates the person and their stay in one submission", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-a`);
    const { siteId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-a`);

    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill("Placed Immediately");
    await page.getByLabel(/^Phone/).fill("9812300001");

    await page.getByLabel("Place them in a bed now").check();
    await page.getByRole("radio").first().check();

    // The rent label follows the billing cycle — the drift that made this an
    // extraction rather than a fourth copy of the same four fields.
    await page.getByLabel("Billing cycle").selectOption("weekly");
    await page.getByLabel("Weekly rent (₹)").fill("2000");
    await page.getByLabel("Deposit (₹)").fill("5000");

    await page.getByRole("button", { name: "Create & place tenant" }).click();

    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    await expect(page.getByText("Stays & Ledger")).toBeVisible();

    // The stay is real, on the right bed, with the terms as typed.
    const url = page.url();
    const tenantId = Number(url.split("/").pop());
    const stays = await request.get(`${BASE}/api/tenants/${tenantId}/stays`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await stays.json();
    expect(body).toHaveLength(1);
    expect(body[0].bed_id).toBe(bedId);
    expect(body[0].rent_amount).toBe(200000); // paise
    expect(body[0].deposit_amount).toBe(500000);
    expect(body[0].rent_cycle).toBe("weekly");
    expect(body[0].end_date ?? null).toBeNull();

    // And the grid agrees the bed is taken.
    const grid = await request.get(`${BASE}/api/sites/${siteId}/grid`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rooms = await grid.json();
    const bed = rooms.flatMap((r: { beds: { id: number; status: string }[] }) => r.beds)
      .find((b: { id: number }) => b.id === bedId);
    expect(bed.status).not.toBe("vacant");
  });

  test("leaving the toggle off still just creates a person", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-b`);
    await createSiteRoomBed(request, token, `${RUN_ID}-b`);

    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel("Full name").fill("No Bed Yet");
    await page.getByLabel(/^Phone/).fill("9812300002");
    await page.getByRole("button", { name: "Create tenant" }).click();

    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    await expect(page.getByText("No stays yet")).toBeVisible();
  });

  test("a missing rent is caught before anyone is created", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-c`);
    await createSiteRoomBed(request, token, `${RUN_ID}-c`);

    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel("Full name").fill("Half Finished");
    await page.getByLabel(/^Phone/).fill("9812300003");
    await page.getByLabel("Place them in a bed now").check();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Create & place tenant" }).click();

    await expect(page.getByText("Enter the rent amount.")).toBeVisible();

    // Still on the form, and no half-made record was left behind — a rent typo
    // must not cost the owner a tenant they then have to finish by hand.
    await expect(page).toHaveURL(/\/tenants\/new$/);
    const tenants = await request.get(`${BASE}/api/tenants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await tenants.json()).toHaveLength(0);
  });
});
