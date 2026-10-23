import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs, TEST_ID_KEY } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `paid-${Date.now()}`;

/**
 * Nearly everyone pays the first rent, and usually the deposit, the day they
 * move in. The three forms that put someone in a bed used to take only the
 * terms, so the money was a second trip to the tenant page, easy to forget,
 * and the new tenant showed as owing from their first morning. Each form now
 * has "Paid today", filled in from the terms, and records real payments.
 *
 * At iPad size with touch, the primary device.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

type Paid = { amount: number; kind: string; payment_type: string; payment_date: string };

async function paymentsOf(request: APIRequestContext, token: string, tenantId: number): Promise<Paid[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const stays = await (await request.get(`${BASE}/api/tenants/${tenantId}/stays`, { headers: auth })).json();
  expect(stays).toHaveLength(1);
  const payments: Paid[] = await (await request.get(`${BASE}/api/stays/${stays[0].id}/payments`, { headers: auth })).json();
  return payments
    .map(({ amount, kind, payment_type, payment_date }) => ({ amount, kind, payment_type, payment_date: payment_date.slice(0, 10) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

test.describe("Paid today, when adding a tenant", () => {
  test("records the first month and the deposit, filled in from the terms", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-a`);
    await createSiteRoomBed(request, token, `${RUN_ID}-a`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill("Arjun Paid Up");
    await page.getByLabel(/^Phone/).fill("9812400001");
    await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Monthly rent (₹)").fill("6000");
    await page.getByLabel("Deposit (₹)").fill("10000");

    // Filled in as the terms are typed, and the button says the total.
    const paid = page.getByRole("region", { name: "Paid today" });
    await expect(paid.getByLabel("Rent · first month (₹)")).toHaveValue("6000");
    await expect(paid.getByLabel("Deposit paid (₹)")).toHaveValue("10000");
    await paid.getByRole("button", { name: "UPI" }).tap();
    await page.getByRole("button", { name: "Add and move in · ₹16,000 paid" }).tap();

    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    await expect(page.getByText(/placed in Room 1 · Bed A · ₹16,000 paid/)).toBeVisible();
    const tenantId = Number(page.url().split("/").pop());
    expect(await paymentsOf(request, token, tenantId)).toEqual([
      { amount: 10_000_00, kind: "deposit", payment_type: "online", payment_date: isoDaysAgo(0) },
      { amount: 6_000_00, kind: "rent", payment_type: "online", payment_date: isoDaysAgo(0) },
    ]);

    // The tenant page counts the deposit as money received, not just agreed.
    await expect(page.getByText("Deposit ₹10,000 received", { exact: true })).toBeVisible();
  });

  test("an amount typed over stays as typed; a deposit cleared records none", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-b`);
    await createSiteRoomBed(request, token, `${RUN_ID}-b`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill("Part Payer");
    await page.getByLabel(/^Phone/).fill("9812400002");
    await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Monthly rent (₹)").fill("6000");
    await page.getByLabel("Deposit (₹)").fill("10000");

    const paid = page.getByRole("region", { name: "Paid today" });
    await paid.getByLabel("Rent · first month (₹)").fill("3000");
    await paid.getByLabel("Deposit paid (₹)").fill("");
    // Changing the terms afterwards leaves what was typed alone.
    await page.getByLabel("Monthly rent (₹)").fill("6500");
    await expect(paid.getByLabel("Rent · first month (₹)")).toHaveValue("3000");

    await page.getByRole("button", { name: "Add and move in · ₹3,000 paid" }).tap();
    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    const tenantId = Number(page.url().split("/").pop());
    expect(await paymentsOf(request, token, tenantId)).toEqual([
      { amount: 3_000_00, kind: "rent", payment_type: "cash", payment_date: isoDaysAgo(0) },
    ]);
  });

  test("“They haven’t paid yet” records nothing", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-c`);
    await createSiteRoomBed(request, token, `${RUN_ID}-c`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill("Pays Later");
    await page.getByLabel(/^Phone/).fill("9812400003");
    await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Monthly rent (₹)").fill("6000");
    await page.getByRole("button", { name: "They haven’t paid yet" }).tap();
    await expect(page.getByText("Nothing is recorded.", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Add and move in", exact: true }).tap();
    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    const tenantId = Number(page.url().split("/").pop());
    expect(await paymentsOf(request, token, tenantId)).toEqual([]);
  });

  test("someone who started earlier is recorded as paying on their start day", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-d`);
    await createSiteRoomBed(request, token, `${RUN_ID}-d`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    const started = isoDaysAgo(5);
    await page.getByLabel("Full name").fill("Started Last Week");
    await page.getByLabel(/^Phone/).fill("9812400004");
    await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Monthly rent (₹)").fill("6000");
    await page.getByLabel("Start date").fill(started);

    const heading = `Paid on ${new Date(`${started}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
    await expect(page.getByRole("region", { name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Add and move in · ₹6,000 paid" }).tap();
    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    const tenantId = Number(page.url().split("/").pop());
    expect(await paymentsOf(request, token, tenantId)).toEqual([
      { amount: 6_000_00, kind: "rent", payment_type: "cash", payment_date: started },
    ]);
  });
});

test("Paid today, when assigning a vacant bed on the grid", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-e`);
  const { siteId } = await createSiteRoomBed(request, token, `${RUN_ID}-e`);
  const tenant = await createTenantViaApi(request, token, { name: "Grid Arrival", phone: "9812400005" });
  await loginAs(page, token);
  await page.goto(`/sites/${siteId}/grid`);

  await page.getByTitle(/vacant/).first().tap();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: /Grid Arrival/ }).tap();
  await drawer.getByLabel("Monthly rent (₹)").fill("6000");
  await drawer.getByLabel("Deposit (₹)").fill("8000");
  await drawer.getByRole("button", { name: "Assign · ₹14,000 paid" }).tap();

  await expect(page.getByText("Grid Arrival assigned to bed Bed A · ₹14,000 paid")).toBeVisible();
  expect(await paymentsOf(request, token, tenant.id)).toEqual([
    { amount: 8_000_00, kind: "deposit", payment_type: "cash", payment_date: isoDaysAgo(0) },
    { amount: 6_000_00, kind: "rent", payment_type: "cash", payment_date: isoDaysAgo(0) },
  ]);
});

test("Paid today, when approving a registration into a bed", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `${RUN_ID}-f`);
  const { siteId } = await createSiteRoomBed(request, token, `${RUN_ID}-f`);
  const name = `Approved Arrival ${RUN_ID}`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name, phone: "9812400006", password: "applicant1", id_proof_front_url: TEST_ID_KEY },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const applicant = await reg.json();

  await loginAs(page, token);
  await page.goto("/pending");
  await page.getByRole("button", { name: new RegExp(name) }).first().tap();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Approve", exact: true }).tap();
  await drawer.getByRole("radio", { name: /Approve & assign bed/ }).check();
  await drawer.getByLabel("Site").selectOption(String(siteId));
  await drawer.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ label: "Room 1 — Bed A" });
  await drawer.getByLabel("Monthly rent (₹)").fill("7000");
  await drawer.getByLabel("Deposit (₹)").fill("14000");
  await drawer.getByRole("region", { name: "Paid today" }).getByRole("button", { name: "UPI" }).tap();
  await drawer.getByRole("button", { name: "Approve & assign · ₹21,000 paid" }).tap();

  await expect(page.getByText(`${name} approved · ₹21,000 paid`)).toBeVisible();
  expect(await paymentsOf(request, token, applicant.id)).toEqual([
    { amount: 14_000_00, kind: "deposit", payment_type: "online", payment_date: isoDaysAgo(0) },
    { amount: 7_000_00, kind: "rent", payment_type: "online", payment_date: isoDaysAgo(0) },
  ]);
});
