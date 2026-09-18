import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Rejecting a tenant's payment proof deleted it. The confirm said "Reject and
 * delete" and meant it: the tenant's claim to have paid vanished from their
 * ledger with no status and no reason (UX audit M6). Now it stays, marked
 * "Not accepted", with the owner's reason, on both sides — and is never money.
 */

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

test.describe("Rejecting a payment proof", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("keeps it, with a reason, on both ledgers — and never counts it", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `reject-${RUN_ID}`);
    const oAuth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `reject-${RUN_ID}`);

    const phone = `94${RUN_ID.slice(-8)}`;
    const tenant = await (await request.post(`${BASE}/public/register/${owner.id}`, {
      data: { name: `Ravi ${RUN_ID}`, phone, password: "tenant1234" },
    })).json();
    await request.post(`${BASE}/api/tenants/${tenant.id}/approve`, {
      headers: oAuth,
      data: { bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: monthStart(0) },
    });
    const tenantToken = (await (await request.post(`${BASE}/tenant-auth/login`, {
      data: { phone, password: "tenant1234" },
    })).json()).token;
    const tAuth = { Authorization: `Bearer ${tenantToken}` };
    const stayId = (await (await request.get(`${BASE}/tenant/stays`, { headers: tAuth })).json())[0].id;
    const proof = await (await request.post(`${BASE}/tenant/stays/${stayId}/payments`, {
      headers: tAuth, data: { amount: 600000, notes: "UPI ref 4411" },
    })).json();

    const balanceBefore = (await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: oAuth })).json()).balance;

    // ── The owner says no, and why ──
    await loginAs(page, token);
    await page.goto("/pending");
    await page.getByRole("button", { name: /Payment Proofs/ }).tap();
    await page.getByRole("button", { name: "Reject" }).tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("stays on their ledger as Not accepted");
    await dialog.getByLabel("Reason").fill("No UPI payment of ₹6,000 arrived that day");
    await dialog.getByRole("button", { name: "Mark not accepted" }).tap();
    await expect(page.getByText(/Marked not accepted/)).toBeVisible();
    await expect(page.getByText("No payment proofs")).toBeVisible();

    // ── The row is kept, marked, and still not money ──
    const listed = await (await request.get(`${BASE}/api/stays/${stayId}/payments`, { headers: oAuth })).json();
    const kept = listed.find((p: { id: number }) => p.id === proof.id);
    expect(kept).toMatchObject({ is_approved: false, rejection_reason: "No UPI payment of ₹6,000 arrived that day" });
    expect(kept.rejected_at).toBeTruthy();
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: oAuth })).json();
    expect(summary.balance).toBe(balanceBefore);
    const dash = await (await request.get(`${BASE}/api/dashboard`, { headers: oAuth })).json();
    expect(dash.alerts.pending_payments).toBe(0);

    // Answered once is answered: a second tap is "already", not "not found".
    const again = await request.post(`${BASE}/api/payments/${proof.id}/reject`, { headers: oAuth, data: { reason: "" } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toContain("already been rejected");

    // ── The owner's own ledger says so ──
    await page.goto(`/tenants/${tenant.id}`); // a lone stay opens its ledger
    await expect(page.getByText("Not accepted")).toBeVisible();
    await expect(page.getByText("No UPI payment of ₹6,000 arrived that day")).toBeVisible();

    // ── And so does the tenant's ──
    await page.context().clearCookies();
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    await expect(page.getByText("Not accepted")).toBeVisible();
    await expect(page.getByText("No UPI payment of ₹6,000 arrived that day")).toBeVisible();
    await expect(page.getByText("Confirmed")).toHaveCount(0);
  });

  test("an approved payment cannot be rejected after the fact", async ({ request }) => {
    const { token } = await createOwner(request, `reject-b-${RUN_ID}`);
    const oAuth = { Authorization: `Bearer ${token}` };
    const { bedId } = await createSiteRoomBed(request, token, `reject-b-${RUN_ID}`);
    const t = await (await request.post(`${BASE}/api/tenants`, {
      headers: oAuth, data: { name: `Owner Paid ${RUN_ID}`, phone: `95${RUN_ID.slice(-8)}` },
    })).json();
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: oAuth,
      data: { tenant_id: t.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: monthStart(0) },
    })).json();
    const paid = await (await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
      headers: oAuth, data: { amount: 500000, payment_type: "cash" },
    })).json();

    const res = await request.post(`${BASE}/api/payments/${paid.id}/reject`, { headers: oAuth, data: { reason: "oops" } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("already been approved");
  });
});
