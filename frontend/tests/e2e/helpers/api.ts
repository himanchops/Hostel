import type { APIRequestContext, Page } from "@playwright/test";

const BASE = "http://localhost:8080";

/**
 * A well-formed upload key for tests that register a tenant through the API.
 *
 * Registration requires the front of an ID, and the server checks only that
 * the reference is a key it could have issued — not that the file exists. A
 * real upload per test would spend the per-IP upload budget
 * (PublicUploadRateLimiter) the whole suite shares from 127.0.0.1, so API-level
 * setup uses this; `public/registration.test.ts` does real uploads.
 */
export const TEST_ID_KEY = "public/e2e00000000000000000000000000000.jpg";

/** Registration also requires an emergency contact; API-level setup sends this one. */
export const TEST_EMERGENCY = { emergency_contact_name: "Test Parent", emergency_contact_phone: "9000000001" };

export async function createOwner(
  request: APIRequestContext,
  runId: string
): Promise<{ token: string; owner: { id: number; name: string; email: string } }> {
  const res = await request.post(`${BASE}/auth/signup`, {
    data: {
      name: `E2E Owner ${runId}`,
      email: `e2e-owner-${runId}@test.local`,
      password: "testpassword123",
    },
  });
  if (!res.ok()) throw new Error(`createOwner failed: ${await res.text()}`);
  return res.json();
}

export async function loginOwner(
  request: APIRequestContext,
  email: string,
  password = "testpassword123"
): Promise<{ token: string }> {
  const res = await request.post(`${BASE}/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`loginOwner failed: ${await res.text()}`);
  return res.json();
}

export async function createTenantViaApi(
  request: APIRequestContext,
  token: string,
  data: { name: string; phone: string; email?: string }
): Promise<{ id: number; name: string; phone: string; is_approved: boolean }> {
  const res = await request.post(`${BASE}/api/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`createTenantViaApi failed (${res.status()}): ${body}`);
  }
  return res.json();
}

export async function createSiteRoomBed(
  request: APIRequestContext,
  token: string,
  runId: string
): Promise<{ siteId: number; roomId: number; bedId: number }> {
  const auth = { Authorization: `Bearer ${token}` };

  const siteRes = await request.post(`${BASE}/api/sites`, {
    headers: auth,
    data: { name: `E2E Site ${runId}` },
  });
  if (!siteRes.ok()) throw new Error(`createSite failed: ${await siteRes.text()}`);
  const { id: siteId } = await siteRes.json();

  const roomRes = await request.post(`${BASE}/api/sites/${siteId}/rooms`, {
    headers: auth,
    data: { name: `Room 1`, floor: 1 },
  });
  if (!roomRes.ok()) throw new Error(`createRoom failed: ${await roomRes.text()}`);
  const { id: roomId } = await roomRes.json();

  const bedRes = await request.post(
    `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`,
    { headers: auth, data: { name: "Bed A" } }
  );
  if (!bedRes.ok()) throw new Error(`createBed failed: ${await bedRes.text()}`);
  const { id: bedId } = await bedRes.json();

  return { siteId, roomId, bedId };
}

/**
 * Approves a registration and gives them a stay, the two calls the pending
 * queue makes. Approving once made the stay itself from a bed and terms in
 * its body; it only approves now (Oct 2026), so a test that wants both says so.
 */
export async function approveIntoStay(
  request: APIRequestContext,
  token: string,
  tenantId: number,
  stay: { bed_id?: number; rent_amount: number; deposit_amount: number; rent_cycle?: string; start_date: string },
): Promise<{ id: number; bed_id: number | null }> {
  const auth = { Authorization: `Bearer ${token}` };
  const approved = await request.post(`${BASE}/api/tenants/${tenantId}/approve`, { headers: auth, data: {} });
  if (!approved.ok()) throw new Error(`approve failed: ${await approved.text()}`);
  const res = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: tenantId, rent_cycle: "monthly", ...stay },
  });
  if (!res.ok()) throw new Error(`stay failed: ${await res.text()}`);
  return res.json();
}

/**
 * Puts the owner's token in localStorage BEFORE any page script runs.
 *
 * The older pattern — goto("/"), setItem, goto(target) — races: the first
 * navigation boots the app unauthenticated, which schedules a redirect to
 * /login, and that redirect can land after the second goto and steal the
 * navigation. It passed for a long time and then started failing roughly one
 * run in two once the app got slower to boot. addInitScript removes the race
 * rather than papering over it with a wait.
 */
export async function loginAs(page: Page, token: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("hostel_token", t);
  }, token);
}

/**
 * The move-out sheet asks once more before it saves a settlement (Oct 2026):
 * "Move Ravi out? Ravi gets ₹10,000 back in cash." Answers yes.
 */
export async function confirmSettle(page: Page) {
  const ask = page.getByRole("dialog").filter({ hasText: "undo the settlement from their page" });
  await ask.getByRole("button", { name: /^(Move out|Settle|Cancel booking)$/ }).click();
}
