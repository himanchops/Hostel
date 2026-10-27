import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  createOwner, createSiteRoomBed, createTenantViaApi, loginAs, approveIntoStay, TEST_ID_KEY, TEST_EMERGENCY,
} from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Correcting a payment (owner, Oct 2026). Delete-and-re-add was the only fix,
 * from a ✕ on every row. Now a payment opens from its row, and its sheet
 * offers what fits it:
 * - the owner's own entry: Change or Delete
 * - a tenant's: Change or "Not accepted after all", never Delete
 * - anything a settlement was worked out from: nothing, until the settlement
 *   is undone, so the settlement's figures can't quietly disagree
 *
 * A change keeps what the payment said before (migration 016).
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

async function stayWithPayment(request: APIRequestContext, suffix: string) {
  const { token } = await createOwner(request, `corr-${suffix}-${RUN_ID}`);
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `corr-${suffix}-${RUN_ID}`);
  const tenant = await createTenantViaApi(request, token, {
    name: `Kiran ${suffix}`,
    phone: `93${RUN_ID.slice(-6)}${suffix.length}${suffix.length}`,
  });
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 750000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: monthStart(-1),
    },
  })).json();
  const payment = await (await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
    headers: auth,
    data: { amount: 750000, payment_type: "cash", kind: "rent", payment_date: monthStart(-1) },
  })).json();
  return { token, auth, tenantId: tenant.id, stayId: stay.id, payment };
}

test.describe("Correcting a payment", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("a change keeps what it said before, and the balance follows", async ({ page, request }) => {
    const s = await stayWithPayment(request, "change");
    await loginAs(page, s.token);
    await page.goto(`/tenants/${s.tenantId}`);

    await page.getByRole("button", { name: /^Open payment of ₹7,500/ }).tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Entered by");
    await expect(sheet).toContainText("You");
    await sheet.getByRole("button", { name: "Change" }).tap();
    await sheet.getByLabel("Amount (₹)").fill("8000");
    await sheet.getByRole("button", { name: "UPI" }).tap();
    await sheet.getByRole("button", { name: "Save" }).tap();
    await expect(page.getByText("Payment changed")).toBeVisible();

    // The row says it was changed; the sheet says from what.
    await expect(page.getByText(/^Changed \d+ \w+ \d{4}$/)).toBeVisible();
    await page.getByRole("button", { name: /^Open payment of ₹8,000/ }).tap();
    await expect(page.getByRole("dialog")).toContainText("was ₹7,500, Cash");
    await page.keyboard.press("Escape");

    const listed = await (await request.get(`${BASE}/api/stays/${s.stayId}/payments`, { headers: s.auth })).json();
    expect(listed[0]).toMatchObject({ amount: 800000, payment_type: "online" });
    expect(listed[0].last_edit).toMatchObject({ amount: 750000, payment_type: "cash", kind: "rent" });

    // Money follows the payment row, not the edit history.
    const summary = await (await request.get(`${BASE}/api/tenants/${s.tenantId}/summary`, { headers: s.auth })).json();
    expect(summary.total_paid).toBe(800000);
  });

  test("a settled payment waits for the settlement to be undone", async ({ page, request }) => {
    const s = await stayWithPayment(request, "lock");
    // Moved out today, settled with the server's own figures.
    const preview = await (await request.get(`${BASE}/api/stays/${s.stayId}/settlement-preview`, { headers: s.auth })).json();
    const settled = await request.post(`${BASE}/api/stays/${s.stayId}/settlement`, {
      headers: s.auth, data: { refund_paise: preview.refund_paise, adjustments: [] },
    });
    expect(settled.ok()).toBeTruthy();

    // The server refuses, in words the owner can act on.
    for (const res of [
      await request.put(`${BASE}/api/payments/${s.payment.id}`, {
        headers: s.auth,
        data: { amount: 100, payment_type: "cash", kind: "rent", payment_date: monthStart(-1), notes: "" },
      }),
      await request.delete(`${BASE}/api/payments/${s.payment.id}`, { headers: s.auth }),
    ]) {
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toContain("Undo the settlement");
    }

    await loginAs(page, s.token);
    await page.goto(`/tenants/${s.tenantId}`);
    await page.getByRole("button", { name: /^Open payment of ₹7,500/ }).tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("undo the settlement first");
    await expect(sheet.getByRole("button", { name: "Change" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Delete…" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Undo it: the stay stays ended, and the payment can change again.
    await page.getByRole("button", { name: "Undo settlement…" }).tap();
    await page.getByRole("dialog").getByRole("button", { name: "Undo settlement" }).tap();
    await expect(page.getByText("Settlement undone")).toBeVisible();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Open payment of ₹7,500/ }).tap();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Change" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A payment remembered after they left can be added to the ended stay.
    await expect(page.getByRole("button", { name: "+ Add payment" })).toBeVisible();

    // Settle again: the sheet works out the money on the day they left (it
    // used to ask about today and be refused), then asks once more.
    await page.getByRole("button", { name: "Settle the money" }).tap();
    await page.getByRole("dialog").getByRole("button", { name: /^Settle( ·|$)/ }).tap();
    const ask = page.getByRole("dialog").filter({ hasText: /Settle Kiran.s stay\?/ });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Settle" }).tap();
    await expect(page.getByText(/Kiran settled/)).toBeVisible();

    // Its payments read as settled again without a reload.
    await page.getByRole("button", { name: /^Open payment of ₹7,500/ }).tap();
    await expect(page.getByRole("dialog")).toContainText("undo the settlement first");
  });

  test("a tenant's payment is never deleted, only not accepted, and can be accepted again", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `corr-tenant-${RUN_ID}`);
    const oAuth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `corr-tenant-${RUN_ID}`);
    const phone = `92${RUN_ID.slice(-8)}`;
    const tenant = await (await request.post(`${BASE}/public/register/${owner.id}`, {
      data: { name: `Asha ${RUN_ID}`, phone, password: "tenant1234", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY },
    })).json();
    await approveIntoStay(request, token, tenant.id, { bed_id: bedId, rent_amount: 600000, deposit_amount: 0, start_date: monthStart(0) });
    const tenantToken = (await (await request.post(`${BASE}/tenant-auth/login`, {
      data: { phone, password: "tenant1234" },
    })).json()).token;
    const tAuth = { Authorization: `Bearer ${tenantToken}` };
    const stayId = (await (await request.get(`${BASE}/tenant/stays`, { headers: tAuth })).json())[0].id;
    const sent = await (await request.post(`${BASE}/tenant/stays/${stayId}/payments`, {
      headers: tAuth, data: { amount: 600000, payment_type: "online", notes: "UPI ref 7781" },
    })).json();
    expect(sent.from_tenant).toBe(true);
    expect((await request.post(`${BASE}/api/payments/${sent.id}/approve`, { headers: oAuth, data: {} })).ok()).toBeTruthy();

    const del = await request.delete(`${BASE}/api/payments/${sent.id}`, { headers: oAuth });
    expect(del.status()).toBe(409);
    expect((await del.json()).error).toContain("Mark it not accepted");

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: /^Open payment of ₹6,000/ }).tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("The tenant");
    await expect(sheet.getByRole("button", { name: "Delete…" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Not accepted after all…" }).tap();
    await sheet.getByLabel("Why? (the tenant sees this)").fill("The UPI never reached the account");
    await sheet.getByRole("button", { name: "Not accepted" }).tap();
    await expect(page.getByText("Marked not accepted")).toBeVisible();
    await expect(page.getByText("The UPI never reached the account")).toBeVisible();

    let summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: oAuth })).json();
    expect(summary.total_paid).toBe(0);

    // Changed mind again.
    await page.getByRole("button", { name: /^Open payment of ₹6,000/ }).tap();
    await page.getByRole("dialog").getByRole("button", { name: "Accept after all" }).tap();
    await expect(page.getByText("Payment accepted")).toBeVisible();
    summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: oAuth })).json();
    expect(summary.total_paid).toBe(600000);
  });
});
