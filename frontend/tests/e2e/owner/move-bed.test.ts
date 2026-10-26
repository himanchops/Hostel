import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * Owner, 24 Oct 2026: "I cannot move a tenant from one room to another", and
 * a tenant who left and came back had no way back in. A move keeps the stay
 * (deposit, payments, rent day), frees the old bed, and can change the rent
 * from this month or the next. A returning tenant gets "Start a new stay" on
 * their own page, and Add tenant notices their number.
 *
 * The stay starts on the 1st of last month at ₹4,500, so whatever day this
 * runs, the move falls in the cycle that began on the 1st of this month.
 */

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function monthStart(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

async function post(request: APIRequestContext, token: string, path: string, data: object) {
  const res = await request.post(`${BASE}${path}`, { headers: auth(token), data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${await res.text()}`);
  return res.json();
}

/** A site with Room 2 (bed 1L) and Room 4 (bed 2U), and a tenant in 1L. */
async function seedMover(request: APIRequestContext, tag: string) {
  const { token } = await createOwner(request, `${tag}-${RUN_ID}`);
  const site = await post(request, token, "/api/sites", { name: `Move Site ${tag} ${RUN_ID}` });
  const room2 = await post(request, token, `/api/sites/${site.id}/rooms`, { name: "Room 2", floor: 1 });
  const room4 = await post(request, token, `/api/sites/${site.id}/rooms`, { name: "Room 4", floor: 1 });
  const bedA = await post(request, token, `/api/sites/${site.id}/rooms/${room2.id}/beds`, { name: "1L" });
  const bedB = await post(request, token, `/api/sites/${site.id}/rooms/${room4.id}/beds`, { name: "2U" });
  const tenant = await createTenantViaApi(request, token, {
    name: `Ajay ${tag}`, phone: `9${RUN_ID.slice(-7)}${tag.length}${tag.charCodeAt(0) % 10}`,
  });
  const stay = await post(request, token, "/api/stays", {
    tenant_id: tenant.id, bed_id: bedA.id, rent_amount: 450000, deposit_amount: 200000,
    rent_cycle: "monthly", start_date: monthStart(-1),
  });
  return { token, siteId: site.id as number, bedA: bedA.id as number, bedB: bedB.id as number, tenant, stay };
}

async function bedStatus(request: APIRequestContext, token: string, siteId: number, bedId: number) {
  const res = await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth(token) });
  const rooms = await res.json();
  return rooms.flatMap((r: { beds: { id: number; status: string; stay_id?: number }[] }) => r.beds)
    .find((b: { id: number }) => b.id === bedId);
}

test.describe("Moving a tenant to another bed", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("from their page, with a new rent from this month", async ({ page, request }) => {
    const { token, siteId, bedA, bedB, tenant, stay } = await seedMover(request, "this");
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    await page.getByRole("button", { name: "Move bed" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Now in Room 2 · 1L")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 4 · 2U" });
    await dialog.getByRole("button", { name: "New rent" }).click();
    await dialog.getByLabel("New rent (₹)").fill("5000");
    await dialog.getByRole("button", { name: /^This month/ }).click();
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(page.getByText(/Moved to Room 4 · 2U/)).toBeVisible();
    await expect(page.getByText(/^Room 4 · 2U/)).toBeVisible();
    await expect(page.getByText(/Moved from Room 2 · 1L on/)).toBeVisible();
    // The card's rent line, not the toast that also says it.
    await expect(page.getByText(new RegExp(`^\\s*→ ₹5,000 from ${dayLabel(monthStart(0))}$`))).toBeVisible();

    // Same stay: last month at ₹4,500, this month at ₹5,000. Nothing paid, so
    // ₹9,500 owed, where repricing the whole stay would have said ₹10,000.
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth(token) })).json();
    expect(summary.balance).toBe(950000);
    const stays = await (await request.get(`${BASE}/api/tenants/${tenant.id}/stays`, { headers: auth(token) })).json();
    expect(stays).toHaveLength(1);
    expect(stays[0].id).toBe(stay.id);
    expect(stays[0].deposit_amount).toBe(200000);

    // The old bed is free, the new one taken.
    expect((await bedStatus(request, token, siteId, bedA)).status).toBe("vacant");
    expect((await bedStatus(request, token, siteId, bedB)).stay_id).toBe(stay.id);
  });

  test("next month leaves this month at the old rent", async ({ request }) => {
    const { token, bedB, tenant, stay } = await seedMover(request, "next");
    await post(request, token, `/api/stays/${stay.id}/move`, {
      bed_id: bedB, moved_on: new Date().toISOString().slice(0, 10),
      rent_amount: 500000, rent_from: "next_cycle",
    });
    // Two months begun, both at ₹4,500; ₹5,000 starts on the 1st of next month.
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth(token) })).json();
    expect(summary.balance).toBe(900000);
    const stays = await (await request.get(`${BASE}/api/tenants/${tenant.id}/stays`, { headers: auth(token) })).json();
    expect(stays[0].rent_changes.at(-1)).toMatchObject({ rent_amount: 500000 });
    expect(stays[0].rent_changes.at(-1).effective_date.slice(0, 10)).toBe(monthStart(1));
  });

  test("from the grid, keeping the rent", async ({ page, request }) => {
    const { token, siteId, bedA, bedB, tenant, stay } = await seedMover(request, "grid");
    await loginAs(page, token);
    await page.goto(`/sites/${siteId}/grid`);

    // Tiles show the bed's label under the first name.
    await page.getByText("Bed 1L").click();
    await page.getByRole("button", { name: "Move bed" }).click();
    const dialog = page.getByRole("dialog", { name: /^Move/ });
    await dialog.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 4 · 2U" });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(page.getByText(/Moved to Room 4 · 2U/)).toBeVisible();
    expect((await bedStatus(request, token, siteId, bedA)).status).toBe("vacant");
    expect((await bedStatus(request, token, siteId, bedB)).stay_id).toBe(stay.id);
    const summary = await (await request.get(`${BASE}/api/tenants/${tenant.id}/summary`, { headers: auth(token) })).json();
    expect(summary.balance).toBe(900000); // 2 × ₹4,500, unchanged
  });

  test("the server refuses a taken bed, the same bed, and an ended stay", async ({ request }) => {
    const { token, bedA, bedB, stay } = await seedMover(request, "refuse");
    const today = new Date().toISOString().slice(0, 10);
    const other = await createTenantViaApi(request, token, { name: "Other", phone: `8${RUN_ID.slice(-9)}` });
    const otherStay = await post(request, token, "/api/stays", {
      tenant_id: other.id, bed_id: bedB, rent_amount: 100000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: today,
    });

    const move = (id: number, data: object) =>
      request.post(`${BASE}/api/stays/${id}/move`, { headers: auth(token), data });
    expect((await move(stay.id, { bed_id: bedB, moved_on: today })).status()).toBe(409);
    expect((await move(stay.id, { bed_id: bedA, moved_on: today })).status()).toBe(400);

    await request.put(`${BASE}/api/stays/${otherStay.id}`, { headers: auth(token), data: { end_date: today } });
    expect((await move(otherStay.id, { bed_id: bedA, moved_on: today })).status()).toBe(409);
  });
});

test.describe("A tenant who comes back", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("gets a new stay from their own page", async ({ page, request }) => {
    const { token, bedB, tenant, stay } = await seedMover(request, "back");
    await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth(token), data: { end_date: new Date().toISOString().slice(0, 10) },
    });

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Start a new stay" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 4 · 2U" });
    await dialog.getByLabel("Monthly rent (₹)").fill("5000");
    await dialog.getByLabel("Deposit (₹)").fill("2000");
    await dialog.getByRole("button", { name: /^Move in/ }).click();

    await expect(page.getByText(/is back, in Room 4 · 2U/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a new stay" })).toHaveCount(0);
    const stays = await (await request.get(`${BASE}/api/tenants/${tenant.id}/stays`, { headers: auth(token) })).json();
    expect(stays).toHaveLength(2);
    const fresh = stays.find((s: { end_date?: string }) => !s.end_date);
    expect(fresh.bed_id).toBe(bedB);
    expect(fresh.rent_amount).toBe(500000);
    expect(fresh.deposit_amount).toBe(200000);
  });

  test("Add tenant notices a number already on the books", async ({ page, request }) => {
    const { token, tenant } = await seedMover(request, "dup");
    await loginAs(page, token);
    await page.goto("/tenants/new");
    await page.getByLabel(/^Phone/).fill(`+91 ${tenant.phone}`);
    const warning = page.getByRole("link", { name: new RegExp(`Same number as ${tenant.name}`) });
    await expect(warning).toBeVisible();
    await warning.click();
    await expect(page).toHaveURL(new RegExp(`/tenants/${tenant.id}$`));
  });
});
