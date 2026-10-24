import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs, TEST_ID_KEY, TEST_EMERGENCY } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Approving a registration reads like Add tenant: who they said they are,
 * then their stay and the money last, on one screen, with the same three
 * answers (Moving in / Booking / Just approve) and the same fields. It was
 * two steps over three radio cards with its own bed dropdowns, and approving
 * made the stay through a second copy of POST /api/stays (Oct 2026).
 *
 * At iPad size with touch, the primary device.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

async function register(request: Parameters<typeof createOwner>[0], ownerId: number, name: string, phone: string) {
  const res = await request.post(`${BASE}/public/register/${ownerId}`, {
    data: { name, phone, password: "applicant1", workplace: "Demo College", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number };
}

test("details, the stay and the money on one screen, with a note kept for the owner", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `approve-a-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, token, `approve-a-${RUN_ID}`);
  const name = `One Screen ${RUN_ID}`;
  const applicant = await register(request, owner.id, name, `91${RUN_ID.slice(-8)}`);

  await loginAs(page, token);
  await page.goto("/pending");
  await page.getByRole("button", { name: new RegExp(name) }).first().tap();
  const drawer = page.getByRole("dialog");

  // No second step: what they gave and the stay are both there from the start.
  await expect(drawer.getByText("Demo College")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Moving in" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  // Nothing is approved until the stay adds up.
  await drawer.getByRole("button", { name: /^Approve & move in/ }).tap();
  await expect(drawer.getByText("Pick a bed, or choose “Booking” or “Just approve”.")).toBeVisible();

  await drawer.getByLabel("Notes").fill("Cousin of a current tenant");
  await drawer.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 1 · Bed A" });
  await drawer.getByLabel("Monthly rent (₹)").fill("6000");
  await drawer.getByLabel("Deposit (₹)").fill("12000");
  await drawer.getByRole("region", { name: "Paid today" }).getByRole("button", { name: "Cash" }).tap();
  await drawer.getByRole("button", { name: "Approve & move in · ₹18,000 paid" }).tap();

  await expect(page.getByText(`${name} approved and placed in Room 1 · Bed A · ₹18,000 paid`)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);

  const auth = { Authorization: `Bearer ${token}` };
  const tenant = await (await request.get(`${BASE}/api/tenants/${applicant.id}`, { headers: auth })).json();
  expect(tenant).toMatchObject({ is_approved: true, notes: "Cousin of a current tenant" });
  const stays = await (await request.get(`${BASE}/api/tenants/${applicant.id}/stays`, { headers: auth })).json();
  expect(stays).toHaveLength(1);
  expect(stays[0].bed_id).toBe(bedId);
});

test("a registration from a number already on the books says so", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `approve-b-${RUN_ID}`);
  const phone = `92${RUN_ID.slice(-8)}`;
  const existing = await createTenantViaApi(request, token, { name: `Already Here ${RUN_ID}`, phone });
  // Typed differently, same number.
  const name = `Scanned Again ${RUN_ID}`;
  await register(request, owner.id, name, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);

  await loginAs(page, token);
  await page.goto("/pending");
  await expect(page.getByText(`Same number as Already Here ${RUN_ID}`)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(name) }).first().tap();

  const warning = page.getByRole("dialog").getByRole("link", { name: /Same number as/ });
  await expect(warning).toContainText(`Already Here ${RUN_ID}`);
  await expect(warning).toHaveAttribute("href", `/tenants/${existing.id}`);
});

test("just approving puts them on the books with no stay, and only once", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `approve-c-${RUN_ID}`);
  const name = `Just Approved ${RUN_ID}`;
  const applicant = await register(request, owner.id, name, `93${RUN_ID.slice(-8)}`);

  await loginAs(page, token);
  await page.goto("/pending");
  await page.getByRole("button", { name: new RegExp(name) }).first().tap();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Just approve" }).tap();
  await expect(drawer.getByLabel("Monthly rent (₹)")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Approve", exact: true }).tap();
  await expect(page.getByText(`${name} approved`, { exact: true })).toBeVisible();

  const auth = { Authorization: `Bearer ${token}` };
  const stays = await (await request.get(`${BASE}/api/tenants/${applicant.id}/stays`, { headers: auth })).json();
  expect(stays).toHaveLength(0);

  // Approving is for registrations still waiting; a second time is not found.
  const again = await request.post(`${BASE}/api/tenants/${applicant.id}/approve`, { headers: auth, data: {} });
  expect(again.status()).toBe(404);
});
