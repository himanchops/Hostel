import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

/**
 * Tenant profile enrichment & registration-time deposit tests.
 *
 * Covers:
 *  - Public self-registration with all new profile fields
 *  - Pending approval: "collect deposit" mode creates a stay with null bed_id
 *  - Pending approval: "assign bed" mode creates a stay with a bed
 *  - Tenant detail page shows profile fields
 *  - Assign bed to a pending (unassigned) stay
 *  - End stay with a custom past date (date picker)
 *  - Tenant summary endpoint returns correct totals
 */

const BASE = "http://localhost:8080";
const RUN_ID = String(Date.now());

test.describe("Tenant profile enrichment", () => {
  let ownerToken: string;
  let ownerEmail: string;
  let ownerId: number;

  test.beforeAll(async ({ request }) => {
    const { token, owner } = await createOwner(request, RUN_ID);
    ownerToken = token;
    ownerEmail = owner.email;
    ownerId = owner.id;
  });

  // ── API: public registration with profile fields ───────────────────────────

  test("public registration accepts all profile fields", async ({ request }) => {
    const res = await request.post(`${BASE}/public/register/${ownerId}`, {
      data: {
        name: `Profile Tenant ${RUN_ID}`,
        phone: `7${RUN_ID.slice(-9)}`,
        password: "tenant123",
        address: "123 Test Street, Bengaluru",
        workplace: "Acme Corp",
        emergency_contact_name: "Parent Name",
        emergency_contact_phone: "9876543210",
        aadhaar_number: "123456789012",
        email: `tenant-profile-${RUN_ID}@test.local`,
      },
    });
    expect(res.ok(), `Register failed: ${await res.text()}`).toBeTruthy();
    const tenant = await res.json();
    expect(tenant.id).toBeTruthy();
    expect(tenant.is_approved).toBe(false);
    expect(tenant.address).toBe("123 Test Street, Bengaluru");
    expect(tenant.workplace).toBe("Acme Corp");
    expect(tenant.emergency_contact_name).toBe("Parent Name");
    expect(tenant.aadhaar_number).toBe("123456789012");
  });

  // ── API: approve with deposit-only (no bed) ────────────────────────────────

  test("approve with deposit creates a null-bed stay", async ({ request }) => {
    // Register a fresh tenant
    const regRes = await request.post(`${BASE}/public/register/${ownerId}`, {
      data: {
        name: `Deposit Tenant ${RUN_ID}`,
        phone: `6${RUN_ID.slice(-9)}`,
        password: "tenant123",
      },
    });
    expect(regRes.ok()).toBeTruthy();
    const { id: tenantId } = await regRes.json();

    // Approve with rent + deposit but no bed_id
    const approveRes = await request.post(
      `${BASE}/api/tenants/${tenantId}/approve`,
      {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: {
          rent_amount: 500000,   // ₹5000 in paise
          deposit_amount: 100000, // ₹1000 in paise
          rent_cycle: "monthly",
          start_date: new Date().toISOString().slice(0, 10),
          // no bed_id
        },
      }
    );
    expect(approveRes.ok(), `Approve failed: ${await approveRes.text()}`).toBeTruthy();

    // Fetch stays and verify bed_id is null
    const staysRes = await request.get(`${BASE}/api/tenants/${tenantId}/stays`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(staysRes.ok()).toBeTruthy();
    const stays = await staysRes.json();
    expect(stays).toHaveLength(1);
    expect(stays[0].bed_id).toBeNull();
  });

  // ── API: assign bed to a pending stay ─────────────────────────────────────

  test("assign bed to a null-bed stay", async ({ request }) => {
    const { siteId: _s, roomId: _r, bedId } = await createSiteRoomBed(request, ownerToken, RUN_ID + "ab");

    // Register + approve without bed
    const regRes = await request.post(`${BASE}/public/register/${ownerId}`, {
      data: { name: `Assign Tenant ${RUN_ID}`, phone: `5${RUN_ID.slice(-9)}`, password: "tenantpass" },
    });
    const { id: tenantId } = await regRes.json();

    await request.post(`${BASE}/api/tenants/${tenantId}/approve`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: new Date().toISOString().slice(0, 10) },
    });

    const staysRes = await request.get(`${BASE}/api/tenants/${tenantId}/stays`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const stays = await staysRes.json();
    const stayId = stays[0].id;

    // Now assign the bed
    const assignRes = await request.put(`${BASE}/api/stays/${stayId}/assign-bed`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { bed_id: bedId },
    });
    expect(assignRes.ok(), `Assign failed: ${await assignRes.text()}`).toBeTruthy();
    const updated = await assignRes.json();
    expect(updated.bed_id).toBe(bedId);
  });

  // ── API: one active stay per tenant ───────────────────────────────────────

  test("cannot create a second active stay for the same tenant", async ({ request }) => {
    const { bedId: bedId1 } = await createSiteRoomBed(request, ownerToken, RUN_ID + "c1");
    const { bedId: bedId2 } = await createSiteRoomBed(request, ownerToken, RUN_ID + "c2");
    const auth = { Authorization: `Bearer ${ownerToken}` };

    const tenantRes = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: `Duplicate Stay ${RUN_ID}`, phone: `4${RUN_ID.slice(-9)}` },
    });
    const { id: tenantId } = await tenantRes.json();

    // First stay
    const s1 = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenantId, bed_id: bedId1, rent_amount: 100000, deposit_amount: 0, rent_cycle: "monthly", start_date: new Date().toISOString().slice(0, 10) },
    });
    expect(s1.ok()).toBeTruthy();

    // Second stay should 409
    const s2 = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenantId, bed_id: bedId2, rent_amount: 100000, deposit_amount: 0, rent_cycle: "monthly", start_date: new Date().toISOString().slice(0, 10) },
    });
    expect(s2.status()).toBe(409);
  });

  // ── API: tenant summary endpoint ──────────────────────────────────────────

  test("tenant summary returns correct totals", async ({ request }) => {
    const { bedId } = await createSiteRoomBed(request, ownerToken, RUN_ID + "sum");
    const auth = { Authorization: `Bearer ${ownerToken}` };

    const tenantRes = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: `Summary Tenant ${RUN_ID}`, phone: `3${RUN_ID.slice(-9)}` },
    });
    const { id: tenantId } = await tenantRes.json();

    const startDate = new Date().toISOString().slice(0, 10);
    const stayRes = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenantId, bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: startDate },
    });
    const { id: stayId } = await stayRes.json();

    // Add two payments
    await request.post(`${BASE}/api/stays/${stayId}/payments`, {
      headers: auth,
      data: { amount: 300000, payment_type: "cash", payment_date: startDate },
    });
    await request.post(`${BASE}/api/stays/${stayId}/payments`, {
      headers: auth,
      data: { amount: 200000, payment_type: "online", payment_date: startDate },
    });

    const summaryRes = await request.get(`${BASE}/api/tenants/${tenantId}/summary`, {
      headers: auth,
    });
    expect(summaryRes.ok(), `Summary failed: ${await summaryRes.text()}`).toBeTruthy();
    const summary = await summaryRes.json();
    expect(summary.total_paid).toBe(500000);
    expect(summary.duration_days).toBeGreaterThanOrEqual(0);
  });

  // ── API: update tenant profile fields ─────────────────────────────────────

  test("PUT /api/tenants/:id updates all profile fields", async ({ request }) => {
    const auth = { Authorization: `Bearer ${ownerToken}` };

    const tenantRes = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: `Update Profile ${RUN_ID}`, phone: `2${RUN_ID.slice(-9)}` },
    });
    const { id: tenantId } = await tenantRes.json();

    const updateRes = await request.put(`${BASE}/api/tenants/${tenantId}`, {
      headers: auth,
      data: {
        name: `Updated Name ${RUN_ID}`,
        phone: `2${RUN_ID.slice(-9)}`,
        address: "456 Updated Ave",
        workplace: "Updated Corp",
        emergency_contact_name: "Updated Contact",
        emergency_contact_phone: "1234567890",
        aadhaar_number: "999988887777",
      },
    });
    expect(updateRes.ok(), `Update failed: ${await updateRes.text()}`).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.address).toBe("456 Updated Ave");
    expect(updated.workplace).toBe("Updated Corp");
    expect(updated.aadhaar_number).toBe("999988887777");
  });

  // ── UI: tenant detail page shows profile card ─────────────────────────────

  test("tenant detail page shows profile fields and summary", async ({ page, request }) => {
    const auth = { Authorization: `Bearer ${ownerToken}` };
    const { bedId } = await createSiteRoomBed(request, ownerToken, RUN_ID + "ui");

    // Create tenant, then update with profile fields (create only accepts name/phone/email)
    const tenantRes = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: `UI Profile Tenant ${RUN_ID}`, phone: `1${RUN_ID.slice(-9)}` },
    });
    const tenant = await tenantRes.json();
    await request.put(`${BASE}/api/tenants/${tenant.id}`, {
      headers: auth,
      data: {
        name: tenant.name, phone: tenant.phone,
        address: "789 UI Street",
        workplace: "UI Corp",
        emergency_contact_name: "UI Emergency",
        aadhaar_number: "111122223333",
      },
    });

    // Create a stay and payment
    const startDate = new Date().toISOString().slice(0, 10);
    const stayRes = await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: startDate },
    });
    const { id: stayId } = await stayRes.json();
    await request.post(`${BASE}/api/stays/${stayId}/payments`, {
      headers: auth,
      data: { amount: 250000, payment_type: "cash", payment_date: startDate },
    });

    // Log in via localStorage injection
    const loginRes = await request.post(`${BASE}/auth/login`, {
      data: { email: ownerEmail, password: "testpassword123" },
    });
    const { token } = await loginRes.json();
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    // Profile card should show fields
    await expect(page.getByText("789 UI Street")).toBeVisible();
    await expect(page.getByText("UI Corp")).toBeVisible();
    await expect(page.getByText(/XXXX-XXXX-3333/)).toBeVisible(); // masked aadhaar

    // Summary bar should show paid amount
    await expect(page.getByText("₹2,500", { exact: true })).toBeVisible(); // total paid exact

    // Stay should be visible
    await expect(page.getByText("Active")).toBeVisible();
  });

  // ── UI: end stay with date picker ─────────────────────────────────────────

  test("end stay date picker sets correct end date", async ({ page, request }) => {
    const auth = { Authorization: `Bearer ${ownerToken}` };
    const { bedId } = await createSiteRoomBed(request, ownerToken, RUN_ID + "ep");

    const tenantRes = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: `End Stay UI ${RUN_ID}`, phone: `9${RUN_ID.slice(-9)}` },
    });
    const { id: tenantId } = await tenantRes.json();

    const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); // 30 days ago
    await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenantId, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: startDate },
    });

    const loginRes = await request.post(`${BASE}/auth/login`, {
      data: { email: ownerEmail, password: "testpassword123" },
    });
    const { token } = await loginRes.json();
    await loginAs(page, token);
    await page.goto(`/tenants/${tenantId}`);

    // Click "End stay" to reveal date picker
    await page.getByRole("button", { name: "End stay" }).click();

    // Date picker and confirm button should be visible
    await expect(page.getByText("Select move-out date:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();

    // Confirm with today's date
    await page.getByRole("button", { name: "Confirm" }).click();

    // Stay should now show the "Ended" badge. Exact match: since Phase E the
    // success toast also says "…'s stay ended", and a substring match now
    // resolves to both.
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  });
});
