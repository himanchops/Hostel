import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, TEST_EMERGENCY, TEST_RULES } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

// A 1×1 PNG: the assertions are about where the file lives, not its pixels.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function phone() {
  return `97${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * Real uploads, through the portal's upload route. The public one is
 * rate-limited per IP for the whole suite (PublicUploadRateLimiter), and this
 * file needs seven files.
 */
async function uploader(request: APIRequestContext, ownerToken: string) {
  const t = await createTenantViaApi(request, ownerToken, { name: `Uploader ${RUN_ID}`, phone: phone() });
  await request.put(`${BASE}/api/tenants/${t.id}/portal-password`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { password: "uploads1" },
  });
  const login = await request.post(`${BASE}/tenant-auth/login`, { data: { phone: t.phone, password: "uploads1" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const { token } = await login.json();
  return async (): Promise<string> => {
    const res = await request.post(`${BASE}/tenant/upload`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: "f.png", mimeType: "image/png", buffer: PNG } },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).key;
  };
}

/** Locally, an upload is served at /uploads/<key> until it is deleted. */
async function fileStatus(request: APIRequestContext, key: string) {
  return (await request.get(`${BASE}/uploads/${key}`)).status();
}

async function setFiles(
  request: APIRequestContext,
  token: string,
  tenant: { id: number; name: string; phone: string },
  files: Record<string, string>,
) {
  const res = await request.put(`${BASE}/api/tenants/${tenant.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: tenant.name, phone: tenant.phone, ...files },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/**
 * A deleted tenant's photo and ID scans used to stay in the bucket: private
 * and unreachable, but someone's Aadhaar card kept for no reason.
 */
test.describe("Files go with the row that held them", () => {
  test("deleting a tenant removes their photo, ID scans and payment proofs", async ({ request }) => {
    const { token } = await createOwner(request, `files-del-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const upload = await uploader(request, token);
    const { bedId } = await createSiteRoomBed(request, token, `files-del-${RUN_ID}`);

    const tenant = await createTenantViaApi(request, token, { name: `Leaving ${RUN_ID}`, phone: phone() });
    const photo = await upload();
    const front = await upload();
    await setFiles(request, token, tenant, { photo_url: photo, id_proof_front_url: front });

    // A proof screenshot from the portal, on their own payment.
    await request.put(`${BASE}/api/tenants/${tenant.id}/portal-password`, { headers: auth, data: { password: "leaving1" } });
    const login = await (await request.post(`${BASE}/tenant-auth/login`, { data: { phone: tenant.phone, password: "leaving1" } })).json();
    const stay = await (await request.post(`${BASE}/api/stays`, {
      headers: auth,
      data: { tenant_id: tenant.id, bed_id: bedId, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: "2026-09-06" },
    })).json();
    const proof = await upload();
    const paid = await request.post(`${BASE}/tenant/stays/${stay.id}/payments`, {
      headers: { Authorization: `Bearer ${login.token}` },
      data: { amount: 500000, payment_type: "online", proof_url: proof },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();

    for (const key of [photo, front, proof]) expect(await fileStatus(request, key), key).toBe(200);

    // Another owner's attempt deletes nothing, files included.
    const other = await createOwner(request, `files-other-${RUN_ID}`);
    const refused = await request.delete(`${BASE}/api/tenants/${tenant.id}`, { headers: { Authorization: `Bearer ${other.token}` } });
    expect(refused.status()).toBe(404);
    for (const key of [photo, front, proof]) expect(await fileStatus(request, key), key).toBe(200);

    const del = await request.delete(`${BASE}/api/tenants/${tenant.id}`, { headers: auth });
    expect(del.ok(), await del.text()).toBeTruthy();
    for (const key of [photo, front, proof]) expect(await fileStatus(request, key), key).toBe(404);
  });

  test("a file another tenant still uses is kept", async ({ request }) => {
    const { token } = await createOwner(request, `files-shared-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const upload = await uploader(request, token);

    // Two records made from one upload, as a duplicate can be.
    const shared = await upload();
    const dup = await createTenantViaApi(request, token, { name: `Duplicate ${RUN_ID}`, phone: phone() });
    const kept = await createTenantViaApi(request, token, { name: `Kept ${RUN_ID}`, phone: phone() });
    await setFiles(request, token, dup, { photo_url: shared });
    await setFiles(request, token, kept, { photo_url: shared });

    expect((await request.delete(`${BASE}/api/tenants/${dup.id}`, { headers: auth })).ok()).toBeTruthy();
    expect(await fileStatus(request, shared)).toBe(200);

    // The kept record's photo still opens through its signed link.
    const body = await (await request.get(`${BASE}/api/tenants/${kept.id}`, { headers: auth })).json();
    const link = body.photo_url;
    expect((await request.get(link)).status()).toBe(200);

    // Once nobody uses it, it goes.
    expect((await request.delete(`${BASE}/api/tenants/${kept.id}`, { headers: auth })).ok()).toBeTruthy();
    expect(await fileStatus(request, shared)).toBe(404);
  });

  test("replacing a photo removes the old one; an edit that leaves it alone keeps it", async ({ request }) => {
    const { token } = await createOwner(request, `files-edit-${RUN_ID}`);
    const upload = await uploader(request, token);
    const tenant = await createTenantViaApi(request, token, { name: `New Photo ${RUN_ID}`, phone: phone() });

    const first = await upload();
    await setFiles(request, token, tenant, { photo_url: first });
    const second = await upload();
    await setFiles(request, token, tenant, { photo_url: second });

    expect(await fileStatus(request, first)).toBe(404);
    expect(await fileStatus(request, second)).toBe(200);

    // Saving the form without touching the photo sends no photo_url.
    await setFiles(request, token, tenant, {});
    expect(await fileStatus(request, second)).toBe(200);
  });

  test("rejecting a registration removes what they uploaded", async ({ request }) => {
    const { token, owner } = await createOwner(request, `files-reject-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const upload = await uploader(request, token);

    const front = await upload();
    const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
      data: { name: `Rejected ${RUN_ID}`, phone: phone(), password: "applicant1", id_proof_front_url: front, ...TEST_EMERGENCY, ...TEST_RULES },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    const { id } = await reg.json();
    expect(await fileStatus(request, front)).toBe(200);

    const rejected = await request.delete(`${BASE}/api/tenants/${id}/reject`, { headers: auth });
    expect(rejected.ok(), await rejected.text()).toBeTruthy();
    expect(await fileStatus(request, front)).toBe(404);
  });
});
