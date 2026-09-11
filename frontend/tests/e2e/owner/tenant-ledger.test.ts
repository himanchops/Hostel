import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The ledger on the tenant page (UX audit M1).
 *
 * It sat behind a clickable <div> whose only affordance was cursor-pointer,
 * which a touchscreen does not have. Five of seven testers never found it;
 * four concluded "there is no way to record a payment from the tenant page",
 * and one re-recorded a payment already saved.
 */

/** The 1st of a month relative to this one, in UTC like the backend's "today". */
function monthStart(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

/** One tenant, one active stay: ₹8,000/month from two months back, three months paid, ₹16,000 deposit agreed and not yet received. */
async function seedOneStay(request: APIRequestContext, suffix: string) {
  const { token } = await createOwner(request, `ledger-${suffix}-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${suffix}`);
  const tenant = await createTenantViaApi(request, token, {
    name: `Ledger ${suffix} ${RUN_ID}`,
    phone: `9${suffix.length}${RUN_ID.slice(-8)}`,
  });
  const stay = await post(request, token, "/api/stays", {
    tenant_id: tenant.id, bed_id: bedId,
    rent_amount: 800000, deposit_amount: 1600000,
    rent_cycle: "monthly", start_date: monthStart(-2),
  });
  for (const m of [-2, -1, 0]) {
    await post(request, token, `/api/stays/${stay.id}/payments`, {
      amount: 800000, payment_type: "cash", payment_date: monthStart(m),
    });
  }
  return { token, tenant, stay };
}

test.describe("Tenant ledger", () => {
  test("a tenant's only stay opens its ledger, with the count and the money on show", async ({ page, request }) => {
    const { token, tenant } = await seedOneStay(request, "one");
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    const ledger = page.getByRole("button", { name: /ledger/i });
    await expect(ledger).toHaveAttribute("aria-expanded", "true");
    await expect(ledger).toContainText("Hide ledger");
    await expect(ledger).toContainText("3 payments");

    // The figure the audit found stuck on "Paid —" is filled in on arrival.
    await expect(page.getByText("Paid ₹24,000")).toBeVisible();
    // And the deposit, which "appeared nowhere", is on the card.
    await expect(page.getByText("Deposit ₹16,000 agreed · ₹0 received")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add payment" })).toBeVisible();

    // A real button: it folds and unfolds from the keyboard.
    await ledger.focus();
    await page.keyboard.press("Enter");
    await expect(ledger).toHaveAttribute("aria-expanded", "false");
    await expect(ledger).toContainText("Show ledger");
    await expect(page.getByRole("button", { name: "+ Add payment" })).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(ledger).toHaveAttribute("aria-expanded", "true");
  });

  test("with several stays each ledger starts shut, and still says what is inside", async ({ page, request }) => {
    const { token } = await createOwner(request, `ledger-two-${RUN_ID}`);
    const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-two`);
    const tenant = await createTenantViaApi(request, token, {
      name: `Ledger Two ${RUN_ID}`,
      phone: `8${RUN_ID.slice(-9)}`,
    });

    // An earlier stay, ended, with two payments — then the current one, with one.
    const earlier = await post(request, token, "/api/stays", {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 700000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-6),
    });
    for (const m of [-6, -5]) {
      await post(request, token, `/api/stays/${earlier.id}/payments`, {
        amount: 700000, payment_type: "cash", payment_date: monthStart(m),
      });
    }
    const end = await request.put(`${BASE}/api/stays/${earlier.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { end_date: monthStart(-4) },
    });
    expect(end.ok()).toBeTruthy();

    const current = await post(request, token, "/api/stays", {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 800000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-1),
    });
    await post(request, token, `/api/stays/${current.id}/payments`, {
      amount: 800000, payment_type: "online", payment_date: monthStart(-1),
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    const shut = page.getByRole("button", { name: /Show ledger/ });
    await expect(shut).toHaveCount(2);
    // The count is readable with the ledger shut — it answers "did my payment
    // save?" without opening anything.
    await expect(shut.filter({ hasText: "2 payments" })).toHaveAttribute("aria-expanded", "false");
    const active = shut.filter({ hasText: "1 payment" });
    await expect(active).toHaveAttribute("aria-expanded", "false");

    await active.click();
    const open = page.getByRole("button", { name: /Hide ledger/ });
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(open).toContainText("1 payment");
    await expect(page.getByRole("button", { name: "+ Add payment" })).toBeVisible();
  });

  test("a deposit recorded from the ledger is held, not counted as rent", async ({ page, request }) => {
    const { token, tenant } = await seedOneStay(request, "deposit");
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText("Paid ₹24,000")).toBeVisible();

    await page.getByRole("button", { name: "+ Add payment" }).click();
    await page.getByLabel("Amount in rupees").fill("16000");
    await page.getByLabel("Payment is for").selectOption("deposit");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Recorded ₹16,000 deposit")).toBeVisible();
    await expect(page.getByRole("button", { name: /ledger/i })).toContainText("4 payments");
    await expect(page.getByRole("cell", { name: /₹16,000\s*Deposit/ })).toBeVisible();

    // Rent paid is unchanged — the deposit did not quietly clear a month.
    await expect(page.getByText("Paid ₹24,000")).toBeVisible();
    await expect(page.getByText("Deposit ₹16,000 received")).toBeVisible();
  });

  test.describe("on a touch iPad", () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test("the ledger opens and shuts with a tap", async ({ page, request }) => {
      const { token, tenant } = await seedOneStay(request, "ipad");
      await loginAs(page, token);
      await page.goto(`/tenants/${tenant.id}`);

      const ledger = page.getByRole("button", { name: /ledger/i });
      await expect(ledger).toHaveAttribute("aria-expanded", "true");
      // Comfortably thumb-sized, which the old header row was not.
      expect((await ledger.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      await ledger.tap();
      await expect(ledger).toHaveAttribute("aria-expanded", "false");
      await ledger.tap();
      await expect(ledger).toHaveAttribute("aria-expanded", "true");
    });
  });
});
