import { APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:8080";

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
