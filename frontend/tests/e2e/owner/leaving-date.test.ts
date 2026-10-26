import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `leave-${Date.now()}`;

/**
 * Some stays come with their end agreed at the door: a guest for five nights,
 * someone here for a month. The leaving date could only be set afterwards, on
 * the tenant page, so a daily guest who had paid for the whole stay showed as
 * owing every morning until someone remembered. Every form that puts someone
 * in a bed now takes "Leaving on", folded away until asked for, and a daily
 * guest's Paid today becomes the whole stay at the nightly rate (owner,
 * 26 Oct 2026: guests are priced per night).
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

function utcDay(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10);
}

async function onlyStay(request: APIRequestContext, token: string, tenantId: number) {
  const auth = { Authorization: `Bearer ${token}` };
  const stays = await (await request.get(`${BASE}/api/tenants/${tenantId}/stays`, { headers: auth })).json();
  expect(stays).toHaveLength(1);
  const payments = await (await request.get(`${BASE}/api/stays/${stays[0].id}/payments`, { headers: auth })).json();
  return {
    stay: stays[0],
    paid: payments.map((p: { amount: number; kind: string }) => ({ amount: p.amount, kind: p.kind })),
  };
}

test("a five-night guest pays for five nights and leaves on the day given", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-a`);
  const { siteId } = await createSiteRoomBed(request, token, `${RUN_ID}-a`);
  await loginAs(page, token);
  await page.goto("/tenants/new");

  await page.getByLabel("Full name").fill("Five Nights");
  await page.getByLabel(/^Phone/).fill("9812500001");
  await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Daily" }).tap();
  await page.getByLabel("Daily rent (₹)").fill("550");

  // Folded away until asked for.
  await expect(page.getByLabel("Leaving on")).toHaveCount(0);
  await page.getByRole("button", { name: "+ Leaving date, if known" }).tap();
  const leaving = utcDay(5);
  await page.getByLabel("Leaving on").fill(leaving);
  await expect(page.getByText("5 nights", { exact: true })).toBeVisible();

  // Paid today is the whole stay, and follows the rate.
  const paid = page.getByRole("region", { name: "Paid today" });
  await expect(paid.getByLabel("Rent · 5 nights (₹)")).toHaveValue("2750");
  await page.getByLabel("Daily rent (₹)").fill("500");
  await expect(paid.getByLabel("Rent · 5 nights (₹)")).toHaveValue("2500");
  await page.getByRole("button", { name: "Add and move in · ₹2,500 paid" }).tap();

  await expect(page).toHaveURL(/\/tenants\/\d+$/);
  const { stay, paid: payments } = await onlyStay(request, token, Number(page.url().split("/").pop()));
  expect(stay.expected_end_date.slice(0, 10)).toBe(leaving);
  // Told at the door is told with notice, so the move-out sheet won't say
  // "no notice given".
  expect(stay.notice_date.slice(0, 10)).toBe(stay.start_date.slice(0, 10));
  expect(payments).toEqual([{ amount: 2_500_00, kind: "rent" }]);

  // On the grid: vacating from the start, and owing nothing.
  await page.goto(`/sites/${siteId}/grid`);
  const tile = page.locator('button[title="Five Nights — Vacating"]');
  await expect(tile).toBeVisible();
  await expect(tile).not.toContainText("₹");
});

test("a monthly stay keeps one month in Paid today; the date still saves", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-b`);
  const { siteId } = await createSiteRoomBed(request, token, `${RUN_ID}-b`);
  const tenant = await createTenantViaApi(request, token, { name: "One Month", phone: "9812500002" });
  await loginAs(page, token);
  await page.goto(`/sites/${siteId}/grid`);

  await page.getByTitle(/vacant/).first().tap();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: /One Month/ }).tap();
  await drawer.getByLabel("Monthly rent (₹)").fill("6000");
  await drawer.getByRole("button", { name: "+ Leaving date, if known" }).tap();
  await drawer.getByLabel("Leaving on").fill(utcDay(30));
  // Nights are a daily guest's measure; a month is a month.
  await expect(drawer.getByText(/nights?$/)).toHaveCount(0);
  await expect(drawer.getByLabel("Rent · first month (₹)")).toHaveValue("6000");
  await drawer.getByRole("button", { name: "Assign · ₹6,000 paid" }).tap();
  await expect(drawer).toBeHidden();

  const { stay } = await onlyStay(request, token, tenant.id);
  expect(stay.expected_end_date.slice(0, 10)).toBe(utcDay(30));
});

test("a leaving date can be taken back, and must come after arrival", async ({ page, request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-c`);
  await createSiteRoomBed(request, token, `${RUN_ID}-c`);
  await loginAs(page, token);
  await page.goto("/tenants/new");

  await page.getByLabel("Full name").fill("Changed Mind");
  await page.getByLabel(/^Phone/).fill("9812500003");
  await page.getByRole("combobox", { name: "Bed", exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Monthly rent (₹)").fill("6000");
  await page.getByRole("button", { name: "+ Leaving date, if known" }).tap();
  await page.getByLabel("Leaving on").fill(utcDay(-1));
  await page.getByRole("button", { name: /^Add and move in/ }).tap();
  await expect(page.getByText("The leaving date must be after the start date.")).toBeVisible();

  await page.getByRole("button", { name: "No leaving date" }).tap();
  await expect(page.getByLabel("Leaving on")).toHaveCount(0);
  await page.getByRole("button", { name: /^Add and move in/ }).tap();
  await expect(page).toHaveURL(/\/tenants\/\d+$/);
  const { stay } = await onlyStay(request, token, Number(page.url().split("/").pop()));
  expect(stay.expected_end_date ?? null).toBeNull();
  expect(stay.notice_date ?? null).toBeNull();
});

test("the API refuses a leaving date that isn't after the start", async ({ request }) => {
  const { token } = await createOwner(request, `${RUN_ID}-d`);
  const { bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-d`);
  const tenant = await createTenantViaApi(request, token, { name: "Same Day", phone: "9812500004" });
  const res = await request.post(`${BASE}/api/stays`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 50000, deposit_amount: 0,
      rent_cycle: "daily", start_date: utcDay(0), expected_end_date: utcDay(0),
    },
  });
  expect(res.status()).toBe(400);
});
