import { test, expect } from "@playwright/test";
import {
  createOwner, createSiteRoomBed, loginAs, approveIntoStay, TEST_ID_KEY, TEST_EMERGENCY,
} from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Screens that answer (owner, 27 Oct 2026): a 404 that says so, a missing
 * tenant or site said rather than bounced, a Pending badge that counts proofs
 * and keeps up, and approving a proof that asks first.
 *
 * The loader between pages (app/(dashboard)/loading.tsx) is not tested here:
 * the dev server does not prefetch loading states, so it never shows one.
 * It was checked against a production build instead (docs/PROGRESS.md).
 */
test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

test("an unknown page, tenant or site says so", async ({ page, request }) => {
  const { token } = await createOwner(request, `fb-a-${RUN_ID}`);
  await loginAs(page, token);

  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "There's no page here" })).toBeVisible();

  await page.goto("/tenants/999999999");
  await expect(page.getByRole("heading", { name: "This tenant isn't on your books" })).toBeVisible();
  await expect(page).toHaveURL(/\/tenants\/999999999$/);
  await expect(page.getByRole("link", { name: "All tenants" })).toBeVisible();

  await page.goto("/sites/999999999/grid");
  await expect(page.getByRole("heading", { name: "This site isn't on your account" })).toBeVisible();
  await expect(page).toHaveURL(/\/sites\/999999999\/grid$/);
});

test("the Pending badge counts proofs, keeps up, and approving asks first", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `fb-b-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, token, `fb-b-${RUN_ID}`);

  // One tenant on the books who sends a payment proof from the portal...
  const phone = `9${RUN_ID.slice(-9)}`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Proof Sender", phone, password: "tenant1234", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const tenant = await reg.json();
  const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  await approveIntoStay(request, token, tenant.id, { bed_id: bedId, rent_amount: 500000, deposit_amount: 0, start_date: start });
  const tenantToken = (await (await request.post(`${BASE}/tenant-auth/login`, { data: { phone, password: "tenant1234" } })).json()).token;
  const stayId = (await (await request.get(`${BASE}/tenant/stays`, { headers: { Authorization: `Bearer ${tenantToken}` } })).json())[0].id;
  const proof = await request.post(`${BASE}/tenant/stays/${stayId}/payments`, {
    headers: { Authorization: `Bearer ${tenantToken}` },
    data: { amount: 500000, payment_type: "online", notes: "UPI" },
  });
  expect(proof.status()).toBe(201);

  // ...and one registration still waiting.
  const waiting = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Still Waiting", phone: `8${RUN_ID.slice(-9)}`, password: "tenant1234", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY },
  });
  expect(waiting.ok()).toBeTruthy();

  await loginAs(page, token);
  await page.goto("/pending");
  const badge = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Pending/ });
  await expect(badge).toContainText("2");

  await page.getByRole("button", { name: /^Tenant payments/ }).tap();
  await page.getByRole("button", { name: "Approve", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Approve ₹5,000 from Proof Sender?");
  await dialog.getByRole("button", { name: "Approve" }).tap();
  await expect(page.getByText("Payment approved")).toBeVisible();
  // On the same page, no reload: the badge follows.
  await expect(badge).toContainText("1");
});
