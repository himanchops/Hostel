import { test, expect, type Page } from "@playwright/test";
import { createOwner, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The tenants list opens newest first, and Name and Moved in re-sort it
 * (owner, Nov 2026). By date, people staying come first, then leavers, then
 * anyone never given a stay; the direction turns round each group, never the
 * order of the groups.
 *
 *   Zara    moved in 60 days ago
 *   Mira    moved in 10 days ago
 *   Kabir   booked from 5 days ahead: the newest of all
 *   Anil    stayed and left
 *   Bela    never given a stay
 */

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

/** The first names, top to bottom, as the list shows them. */
async function order(page: Page): Promise<string[]> {
  const names = await page.locator("ul li a span.text-stone-900").allTextContents();
  return names.map((n) => n.split(" ")[0]);
}

for (const device of [
  { name: "a phone", viewport: { width: 375, height: 812 } },
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
]) {
  test.describe(`The tenants list on ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test("opens newest first, and Name and Moved in re-sort it", async ({ page, request }) => {
      const tag = `ts-${device.viewport.width}-${RUN_ID}`;
      const { token } = await createOwner(request, tag);
      const auth = { Authorization: `Bearer ${token}` };

      const stay = async (first: string, start: string, end?: string) => {
        const tenant = await createTenantViaApi(request, token, {
          name: `${first} ${RUN_ID}`, phone: `94${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
        });
        if (!start) return;
        // A booking: no bed, so the test needs no rooms.
        const res = await request.post(`${BASE}/api/stays`, {
          headers: auth,
          data: { tenant_id: tenant.id, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: start },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        if (end) {
          const s = await res.json();
          const ended = await request.put(`${BASE}/api/stays/${s.id}`, { headers: auth, data: { end_date: end } });
          expect(ended.ok(), await ended.text()).toBeTruthy();
        }
      };
      await stay("Zara", utcDay(-60));
      await stay("Mira", utcDay(-10));
      await stay("Kabir", utcDay(5));
      await stay("Anil", utcDay(-90), utcDay(-30));
      await stay("Bela", "");

      await loginAs(page, token);
      await page.goto("/tenants");
      await expect(page.getByRole("button", { name: /Moved in/ })).toHaveAttribute("aria-pressed", "true");
      expect(await order(page)).toEqual(["Kabir", "Mira", "Zara", "Anil", "Bela"]);

      // Oldest first; leavers and the never-stayed still come after.
      await page.getByRole("button", { name: /Moved in/ }).click();
      expect(await order(page)).toEqual(["Zara", "Mira", "Kabir", "Anil", "Bela"]);

      await page.getByRole("button", { name: /Name/ }).click();
      await expect(page.getByRole("button", { name: /Name/ })).toHaveAttribute("aria-pressed", "true");
      expect(await order(page)).toEqual(["Anil", "Bela", "Kabir", "Mira", "Zara"]);

      await page.getByRole("button", { name: /Name/ }).click();
      expect(await order(page)).toEqual(["Zara", "Mira", "Kabir", "Bela", "Anil"]);

      // Search keeps the order it is in.
      await page.getByPlaceholder("Search by name or phone…").fill("a");
      expect(await order(page)).toEqual(["Zara", "Mira", "Kabir", "Bela", "Anil"]);
    });
  });
}
