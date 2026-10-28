import { test, expect, type Page } from "@playwright/test";
import {
  createOwner, createSiteRoomBed, createTenantViaApi, approveIntoStay, loginAs,
  TEST_ID_KEY, TEST_EMERGENCY, TEST_RULES,
} from "../helpers/api";
import { HOUSE_RULES, HOUSE_RULES_VERSION } from "../../../src/lib/houseRules";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * House rules on the registration form (owner, Oct 2026). Submitting opens
 * the rules: a tick for each money rule, in red, and one for the house rules,
 * in English or Hindi. Nobody registers without them, and the tenant row
 * records which version they agreed to and when.
 *
 * At 375px with touch, because this is someone on a phone in a corridor.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const RULES = HOUSE_RULES[HOUSE_RULES_VERSION];

async function fillForm(page: Page, name: string, phone: string) {
  await page.getByLabel("Full name").fill(name);
  await page.getByPlaceholder("10-digit number").fill(phone);
  await page.getByLabel("Emergency contact").fill("Test Parent");
  await page.getByLabel("Their phone").fill("9000000001");
  await page.getByLabel("ID front").setInputFiles({ name: "id.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel(/^Password/).fill("tenant1234");
}

test("registering means ticking each money rule and the house rules", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `rules-${RUN_ID}`);
  const name = `Rules Reader ${RUN_ID}`;
  await page.goto(`/register/${owner.id}`);
  await fillForm(page, name, `9${RUN_ID.slice(-9)}`);

  // The photo starts uploading as the rules open, not after they are agreed:
  // reading covers the wait.
  const uploaded = page.waitForResponse((r) => r.url().endsWith("/public/upload") && r.ok());
  await page.getByRole("button", { name: "Submit registration" }).tap();
  // Found by role alone: its name changes with the language.
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAccessibleName("Before you register");
  await uploaded;
  await expect(sheet.getByText("Your photos are uploading…")).toHaveCount(0);

  // Every rule is there, word for word, and a money rule reads red.
  for (const rule of RULES.en.money) await expect(sheet.getByText(rule.title)).toBeVisible();
  for (const rule of RULES.en.house) await expect(sheet.getByText(rule)).toBeVisible();
  // Tailwind v4 colours are oklch, so read the pixel back as RGB.
  const [r, g, b] = await sheet.getByText(RULES.en.money[0].title).evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  });
  expect(r).toBeGreaterThan(g + 50);
  expect(r).toBeGreaterThan(b + 50);

  // One tick per money rule, one for the rest.
  const boxes = sheet.getByRole("checkbox");
  await expect(boxes).toHaveCount(RULES.en.money.length + 1);

  // Agreeing with a box left says so, and registers nothing.
  await boxes.nth(0).check();
  await sheet.getByRole("button", { name: "Agree and register" }).tap();
  await expect(sheet.getByText("Tick each one to go on.")).toBeVisible();

  // Hindi, with the ticks kept across the switch.
  await sheet.getByRole("button", { name: "हिंदी" }).tap();
  await expect(sheet.getByText(RULES.hi.money[0].title)).toBeVisible();
  await expect(sheet.getByText(RULES.hi.house[0])).toBeVisible();
  await expect(sheet).toHaveAccessibleName("रजिस्टर करने से पहले");
  await expect(boxes.nth(0)).toBeChecked();

  // Back to the form and in again: the ticks are still there.
  await sheet.getByRole("button", { name: "फ़ॉर्म पर वापस जाएँ" }).tap();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Submit registration" }).tap();
  const again = page.getByRole("dialog", { name: "रजिस्टर करने से पहले" });
  await expect(again.getByRole("checkbox").nth(0)).toBeChecked();

  const pendingBefore = await request.get(`${BASE}/api/tenants?pending=true`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await pendingBefore.json()).some((t: { name: string }) => t.name === name)).toBe(false);

  for (const box of await again.getByRole("checkbox").all()) await box.check();
  await again.getByRole("button", { name: "मंज़ूर है, रजिस्टर करें" }).tap();
  await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();
  await expect(page.getByText("They give you a room and a bed, and you move in.")).toBeVisible();

  // The tenant row says which rules, and when.
  const pending = await request.get(`${BASE}/api/tenants?pending=true`, { headers: { Authorization: `Bearer ${token}` } });
  const created = (await pending.json()).find((t: { name: string }) => t.name === name);
  expect(created.rules_version).toBe(HOUSE_RULES_VERSION);
  expect(Date.now() - Date.parse(created.rules_agreed_at)).toBeLessThan(5 * 60_000);
});

test("the server refuses a registration that agreed to no rules, or old ones", async ({ request }) => {
  const { owner } = await createOwner(request, `rules-api-${RUN_ID}`);
  const base = {
    name: `No Rules ${RUN_ID}`, phone: `8${RUN_ID.slice(-9)}`, password: "tenant1234",
    id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY,
  };
  for (const extra of [{}, { rules_version: "2020-01-01" }]) {
    const res = await request.post(`${BASE}/public/register/${owner.id}`, { data: { ...base, ...extra } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe(
      "The house rules have changed since you opened this page. Reload it and read them again.",
    );
  }
  const ok = await request.post(`${BASE}/public/register/${owner.id}`, { data: { ...base, ...TEST_RULES } });
  expect(ok.status()).toBe(201);
});

test("the owner sees which rules a tenant agreed to; a hand-added tenant shows none", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `rules-owner-${RUN_ID}`);
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: {
      name: `Agreed ${RUN_ID}`, phone: `7${RUN_ID.slice(-9)}`, password: "tenant1234",
      id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES,
    },
  });
  const agreed = await reg.json();
  const byHand = await createTenantViaApi(request, token, { name: `By Hand ${RUN_ID}`, phone: `6${RUN_ID.slice(-9)}` });

  await loginAs(page, token);
  await page.goto(`/tenants/${agreed.id}`);
  const link = page.getByRole("button", { name: /^Agreed \d+ \w+ \d{4}$/ });
  await expect(link).toBeVisible();
  await link.tap();
  const dialog = page.getByRole("dialog", { name: "House rules" });
  await expect(dialog.getByText(RULES.en.money[1].title)).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);

  await page.goto(`/tenants/${byHand.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(`By Hand ${RUN_ID}`) })).toBeVisible();
  await expect(page.getByText("House rules")).toHaveCount(0);
});

test("the portal shows the rules a tenant agreed to", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `rules-portal-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, token, `rules-${RUN_ID}`);
  const phone = `9${RUN_ID.slice(-8)}1`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: {
      name: `Portal Rules ${RUN_ID}`, phone, password: "tenant1234",
      id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES,
    },
  });
  const tenant = await reg.json();
  const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  await approveIntoStay(request, token, tenant.id, { bed_id: bedId, rent_amount: 700000, deposit_amount: 1400000, start_date: start });
  const login = await request.post(`${BASE}/tenant-auth/login`, { data: { phone, password: "tenant1234" } });
  const tenantToken = (await login.json()).token;

  await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
  await page.goto("/my");
  const fold = page.getByRole("button", { name: /House rules/ });
  await expect(fold).toContainText("You agreed on");
  await fold.tap();
  await expect(page.getByText(RULES.en.house[0])).toBeVisible();
  await page.getByRole("button", { name: "हिंदी" }).tap();
  await expect(page.getByText(RULES.hi.money[0].detail)).toBeVisible();
});

// Approved, no bed yet: about to hand over a deposit, which is exactly when
// the notice rule gets read again. The portal once showed them only
// "You're approved" (owner, 28 Oct 2026).
test("an approved tenant with no bed yet still has the rules", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `rules-nobed-${RUN_ID}`);
  const phone = `9${RUN_ID.slice(-8)}2`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: {
      name: `No Bed ${RUN_ID}`, phone, password: "tenant1234",
      id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES,
    },
  });
  const tenant = await reg.json();
  const approve = await request.post(`${BASE}/api/tenants/${tenant.id}/approve`, {
    headers: { Authorization: `Bearer ${token}` }, data: {},
  });
  expect(approve.ok()).toBe(true);
  const login = await request.post(`${BASE}/tenant-auth/login`, { data: { phone, password: "tenant1234" } });
  const tenantToken = (await login.json()).token;

  await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
  await page.goto("/my");
  await expect(page.getByText("You're approved")).toBeVisible();
  const fold = page.getByRole("button", { name: /House rules/ });
  await expect(fold).toContainText("You agreed on");
  await fold.tap();
  await expect(page.getByText(RULES.en.money[1].detail)).toBeVisible();
});
