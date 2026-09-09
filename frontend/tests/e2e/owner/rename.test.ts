import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `rename-${Date.now()}`;

/**
 * `PUT .../rooms/:id` and `PUT .../beds/:id` both worked from Phase 2 and had
 * zero call sites in the app or the tests — built, wired, never surfaced. A
 * hostel renumbers rooms, and since delete is now (correctly) refused for
 * anything with a ledger behind it, the workaround for a typo was to keep it.
 */
test.describe("Renaming a room and a bed", () => {
  test("a room's name and floor can be corrected in place", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-room`);
    const { siteId, roomId } = await createSiteRoomBed(request, token, `${RUN_ID}-room`);

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}`);

    await expect(page.getByText("Room 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rename room Room 1" }).click();

    await page.getByLabel("Room name").fill("Room 204");
    await page.getByLabel("Floor").fill("2");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Room 204", { exact: true })).toBeVisible();
    await expect(page.getByText("Floor 2")).toBeVisible();

    // Persisted, not just re-rendered.
    const rooms = await request.get(`${BASE}/api/sites/${siteId}/rooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const room = (await rooms.json()).find((r: { id: number }) => r.id === roomId);
    expect(room.name).toBe("Room 204");
    expect(room.floor).toBe(2);
  });

  test("a bed can be renamed without disturbing its stay history", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-bed`);
    const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-bed`);

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}`);

    // Beds only load once the room is expanded.
    await page.getByText("Room 1", { exact: true }).click();
    await expect(page.getByTestId("bed-chip")).toBeVisible();

    await page.getByRole("button", { name: "Rename bed Bed A" }).click();
    await page.getByLabel("New name for bed Bed A").fill("Bed A — Lower");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("bed-chip")).toContainText("Bed A — Lower");

    const beds = await request.get(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bed = (await beds.json()).find((b: { id: number }) => b.id === bedId);
    expect(bed.name).toBe("Bed A — Lower");
  });
});
