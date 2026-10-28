import { test, expect } from "@playwright/test";
import {
  createOwner, createSiteRoomBed, createTenantViaApi, loginAs, TEST_ID_KEY, TEST_EMERGENCY, TEST_RULES,
} from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * What people are told, in the owner's words (27 Oct 2026): sentences on the
 * pages anyone can open, the real phone rule, the reason a registered tenant
 * cannot sign in yet, dates as dates, and no "Welcome back" for someone who
 * has never been here.
 */
test("a tenant waiting for approval is told so, not that their password is wrong", async ({ page, request }) => {
  const { owner } = await createOwner(request, `msg-a-${RUN_ID}`);
  const phone = `8${RUN_ID.slice(-9)}`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Waiting Tenant", phone, password: "tenant1234", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();

  await page.goto("/my/login");
  await page.getByLabel(/^Phone/).fill(phone);
  await page.getByLabel(/^Password/).fill("tenant1234");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByText("The hostel hasn't approved your registration yet. You can sign in once they do.")).toBeVisible();

  // A wrong password learns nothing about the registration.
  await page.getByLabel(/^Password/).fill("wrong-password");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.getByText("That phone number and password don't match.")).toBeVisible();
});

test("public replies are sentences", async ({ request }) => {
  const link = await request.get(`${BASE}/public/owners/999999999`);
  expect(link.status()).toBe(404);
  expect((await link.json()).error).toBe("This registration link doesn't work. Ask the hostel for their QR code again.");

  const { owner } = await createOwner(request, `msg-b-${RUN_ID}`);
  const short = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Short Password", phone: `7${RUN_ID.slice(-9)}`, password: "abc", id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES },
  });
  expect((await short.json()).error).toBe("Use at least 6 characters for the password.");

  // 25 Hindi letters is 75 bytes: refused, and the message says why.
  const hindi = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Long Password", phone: `7${RUN_ID.slice(-9)}`, password: "क".repeat(25), id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES },
  });
  expect((await hindi.json()).error).toContain("or about 24 letters in Hindi");
});

test("a ten-digit number that no mobile starts with is told the rule", async ({ page, request }) => {
  const { token } = await createOwner(request, `msg-c-${RUN_ID}`);
  await loginAs(page, token);
  await page.goto("/tenants/new");
  await page.getByLabel("Full name").fill("Wrong Start");
  await page.getByLabel(/^Phone/).fill("1234567899");
  await page.getByRole("button", { name: /^Add/ }).first().click();
  await expect(page.getByText("Enter a 10-digit mobile number starting with 6, 7, 8 or 9.")).toBeVisible();
});

test("a new owner is welcomed, and the tenant page writes dates as dates", async ({ page, request }) => {
  const { token } = await createOwner(request, `msg-d-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, token, `msg-d-${RUN_ID}`);
  const tenant = await createTenantViaApi(request, token, { name: "Dated Tenant", phone: "9812700001" });
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const stay = await request.post(`${BASE}/api/stays`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      tenant_id: tenant.id, bed_id: bedId, rent_amount: 600000, deposit_amount: 0,
      rent_cycle: "monthly", start_date: day(-20), expected_end_date: day(10),
    },
  });
  expect(stay.ok(), await stay.text()).toBeTruthy();
  await request.post(`${BASE}/api/stays/${(await stay.json()).id}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { amount: 600000, payment_type: "cash", payment_date: day(-20) },
  });
  await loginAs(page, token);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome, /);

  await page.goto(`/tenants/${tenant.id}`);
  await expect(page.getByText(/^Leaving \d{1,2} \w{3,4} \d{4}$/)).toBeVisible();
  await page.getByRole("button", { name: /ledger/i }).first().click().catch(() => {});
  // No "2026-10-27" anywhere: the badges, the stay's dates and the ledger.
  await expect(page.locator("main")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
});
