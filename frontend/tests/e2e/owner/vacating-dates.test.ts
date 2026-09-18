import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The dashboard's "Vacating Soon" printed a notice's two dates bare under one
 * heading — "Notice: 2026-08-31" on one row, "Leaving 2026-09-30" on the next.
 * Three testers read the first as "he left nine days ago"; one would have
 * re-let the bed. Each date now says what it is.
 */

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

/** The browser's rendering of a date, e.g. "15 Sept 2026" — asserted as words around it, not as a format. */
function day(page: Page, iso: string): Promise<string> {
  return page.evaluate((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }), iso);
}

async function stayWithNotice(
  request: APIRequestContext, token: string, siteId: number, roomId: number, name: string,
  notice: { notice_date?: string; expected_end_date?: string },
) {
  const auth = { Authorization: `Bearer ${token}` };
  const bed = await (await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth, data: { name } })).json();
  const tenant = await createTenantViaApi(request, token, { name: `${name} ${RUN_ID}`, phone: `97${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` });
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: tenant.id, bed_id: bed.id, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: monthStart(-2) },
  })).json();
  const res = await request.put(`${BASE}/api/stays/${stay.id}`, { headers: auth, data: notice });
  expect(res.ok()).toBeTruthy();
}

for (const device of [
  { name: "a phone", viewport: { width: 375, height: 812 } },
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
]) {
  test.describe(`Vacating Soon on ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test("each date carries its own verb", async ({ page, request }) => {
      const { token } = await createOwner(request, `vac-${device.viewport.width}-${RUN_ID}`);
      const { siteId, roomId } = await createSiteRoomBed(request, token, `vac-${device.viewport.width}-${RUN_ID}`);

      const told = monthStart(-1);
      await stayWithNotice(request, token, siteId, roomId, "Told Only", { notice_date: told });
      await stayWithNotice(request, token, siteId, roomId, "Has Date", { notice_date: told, expected_end_date: utcDay(20) });
      await stayWithNotice(request, token, siteId, roomId, "Overstayed", { notice_date: told, expected_end_date: utcDay(-3) });

      await loginAs(page, token);
      await page.goto("/dashboard");
      const card = page.locator("#vacating");
      const row = (name: string) => card.getByRole("link").filter({ hasText: `${name} ${RUN_ID}` });

      const toldDay = await day(page, told);
      await expect(row("Told Only")).toContainText(`Gave notice ${toldDay} · no leaving date yet`);
      await expect(row("Has Date")).toContainText(`Gave notice ${toldDay} · leaving ${await day(page, utcDay(20))}`);
      await expect(row("Overstayed")).toContainText(
        `Gave notice ${toldDay} · was due to leave ${await day(page, utcDay(-3))}, 3 days ago`,
      );

      // Only the passed departure asks for an answer, in the grid's words.
      await expect(row("Overstayed")).toContainText("Confirm departure");
      await expect(card.getByText("Confirm departure")).toHaveCount(1);
      // The old bare labels are gone.
      await expect(card.getByText(/Notice:/)).toHaveCount(0);

      // The sentences wrap inside the card rather than running off the screen.
      for (const name of ["Told Only", "Has Date", "Overstayed"]) {
        const box = await row(name).boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(device.viewport.width);
      }
    });
  });
}
