import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The grid's orange tiles said who was vacating but not when, so "who leaves
 * this week?" meant opening each one. A vacating tile now carries its leaving
 * date where the rent date would go (owner, 26 Oct 2026). What they owe still
 * shows as an amount.
 *
 *   Dev     leaving in ten days, owes two months  → "leaves <date>" and ₹10,000
 *   Esha    gave notice, no date yet              → "notice given"
 *   Farid   was due to leave three days ago       → "left <date>?"
 */

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

/** "2 Nov" — the tile's own short form. */
function short(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

async function vacating(
  request: APIRequestContext, token: string, siteId: number, roomId: number, first: string,
  notice: { notice_date?: string; expected_end_date?: string },
) {
  const auth = { Authorization: `Bearer ${token}` };
  const bed = await (await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name: first[0] } })).json();
  const tenant = await createTenantViaApi(request, token, {
    name: `${first} ${RUN_ID}`, phone: `96${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  });
  const res = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: tenant.id, bed_id: bed.id, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: monthStart(-1) },
  });
  expect(res.ok()).toBeTruthy();
  const stay = await res.json();
  expect((await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: notice })).ok()).toBeTruthy();
}

const tile = (page: Page, first: string) => page.locator(`button[title^="${first} ${RUN_ID} —"]`);

for (const device of [
  { name: "a phone", viewport: { width: 375, height: 812 } },
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
  { name: "an iPad in landscape", viewport: { width: 1024, height: 768 } },
]) {
  test.describe(`Vacating tiles on ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test("each says when they leave", async ({ page, request }) => {
      const tag = `vt-${device.viewport.width}-${RUN_ID}`;
      const { token } = await createOwner(request, tag);
      const { siteId, roomId } = await createSiteRoomBed(request, token, tag);

      const told = utcDay(-5);
      await vacating(request, token, siteId, roomId, "Dev", { notice_date: told, expected_end_date: utcDay(10) });
      await vacating(request, token, siteId, roomId, "Esha", { notice_date: told });
      await vacating(request, token, siteId, roomId, "Farid", { notice_date: told, expected_end_date: utcDay(-3) });

      await loginAs(page, token);
      await page.goto(`/sites/${siteId}/grid`);
      expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(false);

      await expect(tile(page, "Dev")).toContainText(`leaves ${short(utcDay(10))}`);
      // Owing still shows, as an amount; the rent date gives way to the leaving one.
      await expect(tile(page, "Dev")).toContainText("₹10,000");
      await expect(tile(page, "Dev")).not.toContainText("due ");
      await expect(tile(page, "Esha")).toContainText("notice given");
      await expect(tile(page, "Farid")).toContainText(`left ${short(utcDay(-3))}?`);

      // The longest wording fits the tile without being cut off.
      for (const first of ["Dev", "Esha", "Farid"]) {
        const line = tile(page, first).locator("p").last();
        const cut = await line.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(cut, `${first}'s leaving line is truncated`).toBe(false);
      }
    });
  });
}
