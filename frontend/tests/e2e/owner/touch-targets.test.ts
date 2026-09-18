import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();
const MIN = 44;

/**
 * Almost nothing in the app was a 44px target (UX audit, five testers): the
 * nudge button 32px, inputs 38px, a room's rename and delete 24px with no gap,
 * the portal's Sign out 20px, and the three stay actions 16px text links 12px
 * apart — one of which settles a deposit. The fix is in the shared components,
 * under `pointer-coarse:`, so a mouse keeps the compact layout and a finger
 * gets room. This walks every screen on a touch iPad and measures every
 * control, so a new screen cannot quietly bring the problem back.
 *
 * Exempt, as WCAG 2.5.8 exempts them: a link inside a sentence, whose size is
 * the sentence's. Checkboxes and radios are measured by their label, which is
 * what a finger actually hits.
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

/** Every visible control on the page smaller than MIN either way, described. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const out: string[] = [];
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest("[data-touch-exempt]")) continue;
      let target: HTMLElement = el;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        const label = el.closest("label");
        if (!label) continue; // the grid's own tiles are measured as buttons
        target = label;
      }
      const r = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.opacity === "0") continue;
      // A link inside running text is the sentence's size, not a control's.
      if (el.tagName === "A") {
        const parent = el.parentElement;
        const inline = getComputedStyle(el).display === "inline";
        if (inline && parent && (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 3) continue;
      }
      if (r.height + 0.5 < min || r.width + 0.5 < min) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || `${el.tagName.toLowerCase()}[${el.getAttribute("type") ?? ""}]`)
          .trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`${name} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    return out;
  }, MIN);
}

for (const device of [
  { name: "an iPad in portrait", viewport: { width: 768, height: 1024 } },
  { name: "an iPad in landscape", viewport: { width: 1024, height: 768 } },
  { name: "a phone", viewport: { width: 375, height: 812 } },
]) {
  test.describe(`Touch targets on ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: true, isMobile: true });

    test("every control is at least 44px on every screen", async ({ page, request }) => {
      const id = `touch-${device.viewport.width}-${RUN_ID}`;
      const { token, owner } = await createOwner(request, id);
      const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, id);
      await post(request, token, `/api/sites/${siteId}/rooms/${roomId}/beds`, { name: "Bed B" });

      // One tenant through the portal, so /my has a ledger and a proof to show,
      // and the owner has something in every list: a stay that owes, a notice,
      // a pending proof.
      const phone = `93${RUN_ID.slice(-7)}${device.viewport.width % 10}`;
      const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
        data: { name: `Tara ${RUN_ID}`, phone, password: "tenant1234" },
      });
      if (!reg.ok()) throw new Error(`register failed: ${await reg.text()}`);
      const tenant = await reg.json();
      await post(request, token, `/api/tenants/${tenant.id}/approve`, {
        bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: monthStart(-1),
      });
      const tenantToken = (await (await request.post(`${BASE}/tenant-auth/login`, {
        data: { phone, password: "tenant1234" },
      })).json()).token;
      const stayId = (await (await request.get(`${BASE}/tenant/stays`, {
        headers: { Authorization: `Bearer ${tenantToken}` },
      })).json())[0].id;
      await post(request, tenantToken, `/tenant/stays/${stayId}/payments`, { amount: 100000, notes: "UPI" });
      await request.put(`${BASE}/api/stays/${stayId}`, {
        headers: { Authorization: `Bearer ${token}` }, data: { notice_date: monthStart(0) },
      });
      await post(request, token, `/api/stays/${stayId}/payments`, { amount: 200000, payment_type: "cash" });

      await loginAs(page, token);
      const failures: string[] = [];
      const check = async (label: string) => {
        for (const f of await smallTargets(page)) failures.push(`${label}: ${f}`);
      };

      for (const path of ["/dashboard", "/sites", `/sites/${siteId}`, "/tenants", "/tenants/new", "/collections", "/pending", "/account", "/insights"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await check(path);
      }

      await page.goto(`/sites/${siteId}`);
      await page.getByRole("button", { name: /Room 1/ }).first().tap();
      await expect(page.getByTestId("bed-chip").first()).toBeVisible();
      await check("site, room open");

      await page.goto("/collections");
      await page.getByRole("button", { name: "Record payment" }).first().tap();
      await check("/collections, recording");

      await page.goto("/pending");
      await page.getByRole("button", { name: /Payment Proofs/ }).tap();
      await expect(page.getByText(/Tara/).first()).toBeVisible();
      await check("/pending, proofs");

      await page.goto(`/sites/${siteId}/grid`);
      await page.waitForLoadState("networkidle");
      await check("grid");
      await page.getByText("Tara", { exact: true }).first().tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await check("grid, bed drawer");

      await page.goto(`/tenants/${tenant.id}`);
      await page.waitForLoadState("networkidle");
      await check("tenant");
      await page.getByRole("button", { name: /payments/i }).first().tap();
      await page.waitForLoadState("networkidle");
      await check("tenant, ledger open");

      // The tenant's side, in a clean session.
      await page.context().clearCookies();
      await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
      await page.goto("/my");
      await page.waitForLoadState("networkidle");
      await check("/my");
      await page.getByRole("button", { name: "Submit payment" }).tap();
      await check("/my, paying");

      expect(failures, failures.join("\n")).toEqual([]);
    });
  });
}
