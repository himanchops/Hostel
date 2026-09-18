import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The tenant profile named the bed by database id — `Bed #31` — where every
 * other screen says `Room 202 · 1L` (UX audit M7, five testers). The stays
 * list now carries the names, and the card keeps them through the edits that
 * patch a stay from a bare-row response.
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

test.describe("The bed on the tenant profile", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("is named by room and bed, and keeps the name through a notice", async ({ page, request }) => {
    const { token } = await createOwner(request, `label-a-${RUN_ID}`);
    const { bedId } = await createSiteRoomBed(request, token, `label-a-${RUN_ID}`);
    const tenant = await createTenantViaApi(request, token, { name: `Labelled ${RUN_ID}`, phone: `95${RUN_ID.slice(-8)}` });
    await post(request, token, "/api/stays", {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-1),
    });

    // The API says where, not just which id.
    const stays = await (await request.get(`${BASE}/api/tenants/${tenant.id}/stays`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(stays[0]).toMatchObject({ room_name: "Room 1", bed_name: "Bed A", site_name: `E2E Site label-a-${RUN_ID}` });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText("Room 1 · Bed A")).toBeVisible();
    await expect(page.getByText(/Bed #\d/)).toHaveCount(0);

    // Recording a notice patches the stay from a response without the names.
    await page.getByRole("button", { name: "Record notice" }).tap();
    await page.getByRole("button", { name: "Save" }).tap();
    await expect(page.getByRole("button", { name: "Update notice" })).toBeVisible();
    await expect(page.getByText("Room 1 · Bed A")).toBeVisible();
  });

  test("appears once a waiting stay is given a bed", async ({ page, request }) => {
    const { token } = await createOwner(request, `label-b-${RUN_ID}`);
    const { siteId, roomId } = await createSiteRoomBed(request, token, `label-b-${RUN_ID}`);
    await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed B" });
    const tenant = await createTenantViaApi(request, token, { name: `Waiting ${RUN_ID}`, phone: `96${RUN_ID.slice(-8)}` });
    await post(request, token, "/api/stays", {
      tenant_id: tenant.id, rent_amount: 500000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(0),
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText("Bed unassigned")).toBeVisible();

    await page.getByRole("button", { name: "Assign bed" }).tap();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Room 1 · Bed B" }).check();
    await dialog.getByRole("button", { name: "Assign", exact: true }).tap();

    await expect(page.getByText("Bed assigned", { exact: true }).first()).toBeVisible(); // the toast
    await expect(page.getByText("Room 1 · Bed B")).toBeVisible();
    await expect(page.getByText("Bed unassigned")).toHaveCount(0);
  });
});
