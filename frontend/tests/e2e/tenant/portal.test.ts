import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();
const TENANT_PASSWORD = "tenant1234";

/**
 * The tenant portal had no e2e coverage at all, and shipped with its payment
 * submission broken from the first commit: the INSERT reused one placeholder
 * for `payment_date` (DATE) and `created_at` (TIMESTAMPTZ), so Postgres
 * refused the statement with 42P08 and every submission 500'd. Nothing caught
 * it because nothing ever exercised it.
 */

/** A tenant with a password can only be made through public registration. */
async function seedPortalTenant(
  request: APIRequestContext,
  suffix: string
): Promise<{ ownerToken: string; tenantToken: string; stayId: number; tenantId: number }> {
  const { token: ownerToken, owner } = await createOwner(request, `portal-${suffix}-${RUN_ID}`);
  const auth = { Authorization: `Bearer ${ownerToken}` };
  const { bedId } = await createSiteRoomBed(request, ownerToken, `${suffix}-${RUN_ID}`);
  const phone = `9${suffix}${RUN_ID.slice(-8)}`;

  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: `Portal Tenant ${suffix} ${RUN_ID}`, phone, password: TENANT_PASSWORD },
  });
  if (!reg.ok()) throw new Error(`register failed: ${await reg.text()}`);
  const tenant = await reg.json();

  const start = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  const approve = await request.post(`${BASE}/api/tenants/${tenant.id}/approve`, {
    headers: auth,
    data: {
      bed_id: bedId, rent_amount: 700000, deposit_amount: 1400000,
      rent_cycle: "monthly", start_date: start,
    },
  });
  if (!approve.ok()) throw new Error(`approve failed: ${await approve.text()}`);

  const login = await request.post(`${BASE}/tenant-auth/login`, {
    data: { phone, password: TENANT_PASSWORD },
  });
  if (!login.ok()) throw new Error(`tenant login failed: ${await login.text()}`);
  const tenantToken = (await login.json()).token;

  const stays = await request.get(`${BASE}/tenant/stays`, {
    headers: { Authorization: `Bearer ${tenantToken}` },
  });
  const stayId = (await stays.json())[0].id;

  return { ownerToken, tenantToken, stayId, tenantId: tenant.id };
}

test.describe("Tenant portal", () => {
  test("a submitted payment reaches the owner's queue and counts once approved", async ({ request }) => {
    const { ownerToken, tenantToken, stayId } = await seedPortalTenant(request, "1");
    const tAuth = { Authorization: `Bearer ${tenantToken}` };
    const oAuth = { Authorization: `Bearer ${ownerToken}` };

    // ── The submission itself: this is the call that used to 500 ──
    const submit = await request.post(`${BASE}/tenant/stays/${stayId}/payments`, {
      headers: tAuth,
      data: { amount: 700000, notes: "Paid by UPI this morning" },
    });
    expect(submit.status()).toBe(201);
    const payment = await submit.json();
    expect(payment.amount).toBe(700000);
    expect(payment.notes).toBe("Paid by UPI this morning");
    // Tenant-submitted money is a claim, not a fact, until the owner says so.
    expect(payment.is_approved).toBe(false);

    // ── It shows up for the owner, with the tenant's own note intact ──
    const pending = await request.get(`${BASE}/api/payments/pending`, { headers: oAuth });
    expect(pending.status()).toBe(200);
    const queued = (await pending.json()).find(
      (p: { id: number }) => p.id === payment.id
    );
    expect(queued).toBeTruthy();
    expect(queued.amount).toBe(700000);

    // ── Unapproved money must not move any figure ──
    const before = await request.get(`${BASE}/api/collections`, { headers: oAuth });
    const owedBefore = (await before.json())[0].balance_paise;
    expect(owedBefore).toBe(1400000); // two cycles billed, nothing approved yet

    // ── Approving it is what makes it count ──
    const approve = await request.post(`${BASE}/api/payments/${payment.id}/approve`, {
      headers: oAuth,
      data: {},
    });
    expect(approve.status()).toBeLessThan(300);

    const after = await request.get(`${BASE}/api/collections`, { headers: oAuth });
    const rows = await after.json();
    expect(rows[0].balance_paise).toBe(owedBefore - 700000);
  });

  test("a tenant gives notice from the portal and the owner sees it", async ({ request }) => {
    const { ownerToken, tenantToken, stayId, tenantId } = await seedPortalTenant(request, "2");

    const notice = await request.put(`${BASE}/tenant/stays/${stayId}/notice`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
      data: {},
    });
    expect(notice.status()).toBeLessThan(300);

    const stays = await request.get(`${BASE}/api/tenants/${tenantId}/stays`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const stay = (await stays.json()).find((s: { id: number }) => s.id === stayId);
    expect(stay.notice_date).toBeTruthy();
    expect(stay.end_date).toBeFalsy(); // notice is not a move-out
  });

  test("a tenant cannot submit a payment against someone else's stay", async ({ request }) => {
    const a = await seedPortalTenant(request, "3");
    const b = await seedPortalTenant(request, "4");

    const res = await request.post(`${BASE}/tenant/stays/${b.stayId}/payments`, {
      headers: { Authorization: `Bearer ${a.tenantToken}` },
      data: { amount: 500000 },
    });
    expect(res.status()).toBe(404);
  });

  test("the portal shows the stay and its ledger", async ({ page, request }) => {
    const { tenantToken, stayId } = await seedPortalTenant(request, "5");
    await request.post(`${BASE}/tenant/stays/${stayId}/payments`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
      data: { amount: 700000, notes: "October rent" },
    });

    await page.addInitScript((t) => {
      localStorage.setItem("hostel_tenant_token", t);
    }, tenantToken);
    await page.goto("/my");

    await expect(page.getByText("₹7,000").first()).toBeVisible();
    await expect(page.getByText("October rent")).toBeVisible();
  });
});
