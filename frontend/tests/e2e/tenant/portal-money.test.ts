import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs, TEST_ID_KEY, TEST_EMERGENCY, TEST_RULES } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();
const PASSWORD = "tenant1234";

/**
 * What a tenant sees once they sign in (Oct 2026). The portal used to show
 * only a list of payments, so a tenant two months behind saw a green "Active"
 * and a green "Confirmed" and nothing else. It now says what they owe, from
 * the owner's own figures, and says something sensible when there is nothing
 * to show.
 */

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const short = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

/** Registers through the public form (the only way to get a password), approves, and signs in. */
async function registered(
  request: APIRequestContext,
  suffix: string,
  stay?: { bed?: boolean; start: string },
) {
  const { token: ownerToken, owner } = await createOwner(request, `pmoney-${suffix}-${RUN_ID}`);
  const { bedId } = await createSiteRoomBed(request, ownerToken, `pm-${suffix}-${RUN_ID}`);
  const oAuth = { Authorization: `Bearer ${ownerToken}` };
  // Unique per tenant: sign-in looks across every owner by number.
  const phone = `8${suffix.padStart(2, "0")}${RUN_ID.slice(-7)}`;

  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: `Money ${suffix} ${RUN_ID}`, phone, password: PASSWORD, id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES },
  });
  if (!reg.ok()) throw new Error(`register failed: ${await reg.text()}`);
  const tenant = await reg.json();
  const ok = await request.post(`${BASE}/api/tenants/${tenant.id}/approve`, { headers: oAuth, data: {} });
  if (!ok.ok()) throw new Error(`approve failed: ${await ok.text()}`);

  if (stay) {
    const res = await request.post(`${BASE}/api/stays`, {
      headers: oAuth,
      data: {
        tenant_id: tenant.id,
        ...(stay.bed === false ? {} : { bed_id: bedId }),
        rent_amount: 700000,
        deposit_amount: 1400000,
        rent_cycle: "monthly",
        start_date: stay.start,
      },
    });
    if (!res.ok()) throw new Error(`stay failed: ${await res.text()}`);
  }

  const login = await request.post(`${BASE}/tenant-auth/login`, { data: { phone, password: PASSWORD } });
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`);
  return { ownerToken, oAuth, tenantId: tenant.id as number, tenantToken: (await login.json()).token as string, phone };
}

test.describe("Tenant portal: what they owe", () => {
  test("says what they owe in the owner's own figures, and moves once the owner confirms", async ({ page, request }) => {
    // Forty days in: two monthly rents billed, nothing paid, deposit agreed.
    const start = iso(Date.now() - 40 * DAY);
    const { oAuth, tenantId, tenantToken } = await registered(request, "1", { start });

    // The portal reads the owner's summary, not a copy of it.
    const mine = await (await request.get(`${BASE}/tenant/summary`, { headers: { Authorization: `Bearer ${tenantToken}` } })).json();
    const owners = await (await request.get(`${BASE}/api/tenants/${tenantId}/summary`, { headers: oAuth })).json();
    expect(mine).toEqual(owners);
    expect(mine.balance).toBe(1400000);
    expect(mine.deposit_due).toBe(1400000);

    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    await expect(page.getByText("You owe ₹14,000")).toBeVisible();
    await expect(page.getByText(`Rent due since ${short(start)}`)).toBeVisible();
    await expect(page.getByText("Deposit ₹14,000 not paid yet")).toBeVisible();
    await expect(page.getByText("₹7,000 a month", { exact: false })).toBeVisible();

    // "Record a payment" fills in what they owe.
    await page.getByRole("button", { name: "Record a payment" }).click();
    await expect(page.getByLabel("Amount in rupees")).toHaveValue("14000");
    await page.getByRole("button", { name: "UPI", exact: true }).click();
    await page.getByLabel("Note").fill("UPI 4321");
    await page.getByRole("button", { name: "Send" }).click();

    // Sent is not paid: the amount owed stands until the owner confirms.
    await expect(page.getByText("₹14,000 you sent is waiting for the owner to confirm.")).toBeVisible();
    await expect(page.getByText("You owe ₹14,000")).toBeVisible();

    const pending = await (await request.get(`${BASE}/api/payments/pending`, { headers: oAuth })).json();
    const sent = pending.find((p: { notes?: string }) => p.notes === "UPI 4321");
    expect(sent.amount).toBe(1400000);
    const approve = await request.post(`${BASE}/api/payments/${sent.id}/approve`, { headers: oAuth, data: {} });
    expect(approve.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText("You're paid up")).toBeVisible();
    await expect(page.getByText(/^Next rent ₹7,000 due /)).toBeVisible();
    await expect(page.getByText(/waiting for the owner/)).toHaveCount(0);
  });

  test("approved with no room yet says so, instead of 'no stays'", async ({ page, request }) => {
    const { tenantToken } = await registered(request, "2");
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    await expect(page.getByText("You're approved")).toBeVisible();
    await expect(page.getByText("Your room will show here once it's set up.")).toBeVisible();
  });

  test("a booking reads as a booking, not ' ·  · Unassigned'", async ({ page, request }) => {
    const { tenantToken } = await registered(request, "3", { bed: false, start: iso(Date.now() + 10 * DAY) });
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    await expect(page.getByText("Booking", { exact: true })).toBeVisible();
    await expect(page.getByText("You’ll get a bed when you arrive.")).toBeVisible();
    await expect(page.getByText("Booked", { exact: true })).toBeVisible();
    await expect(page.getByText(/Unassigned/)).toHaveCount(0);
  });

  test("the header names the hostel", async ({ page, request }) => {
    const { tenantToken } = await registered(request, "4", { start: iso(Date.now() - 5 * DAY) });
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    // One site, so the hostel is that site (the registration page's rule).
    await expect(page.getByRole("link", { name: `E2E Site pm-4-${RUN_ID}` })).toBeVisible();
    await expect(page.getByText("My Portal")).toHaveCount(0);
  });

  test("a failed load says so, and Try again recovers", async ({ page, request }) => {
    const { tenantToken } = await registered(request, "5", { start: iso(Date.now() - 5 * DAY) });
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    let fail = true;
    await page.route("**/tenant/summary", (route) => (fail ? route.abort() : route.continue()));
    await page.goto("/my");
    await expect(page.getByText("Couldn't load your details")).toBeVisible();
    await expect(page.getByText(/No stays/)).toHaveCount(0);

    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("You owe ₹7,000")).toBeVisible();
  });
});

test.describe("Tenant portal: recording a payment", () => {
  test("cash or UPI, the tenant says which, and the owner sees it", async ({ page, request }) => {
    const { ownerToken, oAuth, tenantToken } = await registered(request, "7", { start: iso(Date.now() - 5 * DAY) });
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");

    await page.getByRole("button", { name: "Record a payment" }).click();
    // Nothing is picked for them, and sending without a choice says so.
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "UPI", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Choose cash or UPI.")).toBeVisible();

    // A screenshot belongs to UPI only.
    await page.getByRole("button", { name: "UPI", exact: true }).click();
    await expect(page.getByText("Screenshot", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cash", exact: true }).click();
    await expect(page.getByText("Screenshot", { exact: true })).toHaveCount(0);

    await page.getByLabel("Amount in rupees").fill("3000");
    await page.getByLabel("Note").fill("Gave it to Aunty");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Gave it to Aunty")).toBeVisible();

    const pending = await (await request.get(`${BASE}/api/payments/pending`, { headers: oAuth })).json();
    expect(pending.find((p: { notes?: string }) => p.notes === "Gave it to Aunty").payment_type).toBe("cash");

    // In the owner's queue it reads as cash.
    await loginAs(page, ownerToken);
    await page.goto("/pending?tab=payments");
    await expect(page.getByText(/· ₹3,000 · Cash/)).toBeVisible();
  });

  test("a payment with no method is refused", async ({ request }) => {
    const { tenantToken } = await registered(request, "8", { start: iso(Date.now() - 5 * DAY) });
    const auth = { Authorization: `Bearer ${tenantToken}` };
    const stayId = (await (await request.get(`${BASE}/tenant/stays`, { headers: auth })).json())[0].id;
    const res = await request.post(`${BASE}/tenant/stays/${stayId}/payments`, { headers: auth, data: { amount: 100000 } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Say whether you paid by cash or UPI.");
  });

  test("a payment the owner records shows in the portal as confirmed", async ({ page, request }) => {
    const { oAuth, tenantToken } = await registered(request, "9", { start: iso(Date.now() - 5 * DAY) });
    const stayId = (await (await request.get(`${BASE}/tenant/stays`, { headers: { Authorization: `Bearer ${tenantToken}` } })).json())[0].id;
    const res = await request.post(`${BASE}/api/stays/${stayId}/payments`, {
      headers: oAuth,
      data: { amount: 700000, payment_type: "cash", payment_date: iso(Date.now()), notes: "At the desk" },
    });
    expect(res.ok()).toBeTruthy();

    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");
    const row = page.getByText("At the desk").locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(row.getByText(/· Cash/)).toBeVisible();
    await expect(page.getByText("You're paid up")).toBeVisible();
  });
});

test.describe("Tenant portal: notice to vacate", () => {
  test("notice stands out, its date can change, and it can be withdrawn", async ({ page, request }) => {
    const { oAuth, tenantId, tenantToken } = await registered(request, "10", { start: iso(Date.now() - 20 * DAY) });
    await page.addInitScript((t) => localStorage.setItem("hostel_tenant_token", t), tenantToken);
    await page.goto("/my");

    const first = iso(Date.now() + 20 * DAY);
    await page.getByRole("button", { name: /Give notice to vacate/ }).click();
    await page.getByLabel("When are you leaving?").fill(first);
    await page.getByRole("button", { name: "Submit notice" }).click();
    await expect(page.getByText(`You’re leaving on ${longDate(first)}`)).toBeVisible();

    const ownerStay = async () =>
      (await (await request.get(`${BASE}/api/tenants/${tenantId}/stays`, { headers: oAuth })).json())[0];
    const noticeDate = (await ownerStay()).notice_date;
    expect(noticeDate).toBeTruthy();

    // Moving the date is not a new notice: when they first said so stands,
    // because it decides whether the deposit comes back.
    const later = iso(Date.now() + 35 * DAY);
    await page.getByRole("button", { name: "Change date" }).click();
    await page.getByLabel("New leaving date").fill(later);
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(page.getByText(`You’re leaving on ${longDate(later)}`)).toBeVisible();
    const moved = await ownerStay();
    expect(moved.expected_end_date.slice(0, 10)).toBe(later);
    expect(moved.notice_date).toBe(noticeDate);

    // Taken back: both dates gone, as with the owner's "They're staying".
    await page.getByRole("button", { name: "Withdraw notice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Withdraw notice" }).click();
    await expect(page.getByText(/You’re leaving on/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Give notice to vacate/ })).toBeVisible();
    const withdrawn = await ownerStay();
    expect(withdrawn.notice_date).toBeFalsy();
    expect(withdrawn.expected_end_date).toBeFalsy();
  });

  test("a tenant can only withdraw notice on their own stay", async ({ request }) => {
    const a = await registered(request, "11", { start: iso(Date.now() - 5 * DAY) });
    const b = await registered(request, "12", { start: iso(Date.now() - 5 * DAY) });
    const aAuth = { Authorization: `Bearer ${a.tenantToken}` };
    const aStay = (await (await request.get(`${BASE}/tenant/stays`, { headers: aAuth })).json())[0].id;
    await request.put(`${BASE}/tenant/stays/${aStay}/notice`, { headers: aAuth, data: {} });

    const res = await request.delete(`${BASE}/tenant/stays/${aStay}/notice`, {
      headers: { Authorization: `Bearer ${b.tenantToken}` },
    });
    expect(res.status()).toBe(404);
    const still = (await (await request.get(`${BASE}/tenant/stays`, { headers: aAuth })).json())[0];
    expect(still.notice_date).toBeTruthy();
  });
});

test.describe("Phone numbers", () => {
  test("sign-in takes the number however it is written", async ({ request }) => {
    const { phone } = await registered(request, "6");
    for (const typed of [`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, `0${phone}`, `91${phone}`]) {
      const res = await request.post(`${BASE}/tenant-auth/login`, { data: { phone: typed, password: PASSWORD } });
      expect(res.status(), typed).toBe(200);
    }
    const wrong = await request.post(`${BASE}/tenant-auth/login`, { data: { phone, password: "not-it" } });
    expect(wrong.status()).toBe(401);
  });

  test("a number written with +91 is stored as ten digits", async ({ request }) => {
    const { token: ownerToken } = await createOwner(request, `pm-store-${RUN_ID}`);
    const t = await createTenantViaApi(request, ownerToken, { name: "Stored Plain", phone: `+91 87${RUN_ID.slice(-3)} ${RUN_ID.slice(-5)}` });
    expect(t.phone).toBe(`87${RUN_ID.slice(-3)}${RUN_ID.slice(-5)}`);
  });

  test("every form refuses a number that is not a mobile", async ({ page, request }) => {
    const { token: ownerToken, owner } = await createOwner(request, `pm-bad-${RUN_ID}`);
    const oAuth = { Authorization: `Bearer ${ownerToken}` };

    const reg = (data: Record<string, string>) =>
      request.post(`${BASE}/public/register/${owner.id}`, {
        data: { name: "Bad Phone", phone: "9845012345", password: PASSWORD, id_proof_front_url: TEST_ID_KEY, ...TEST_EMERGENCY, ...TEST_RULES, ...data },
      });
    let res = await reg({ phone: "12345" });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Enter a 10-digit mobile number starting with 6, 7, 8 or 9.");
    res = await reg({ emergency_contact_phone: "call dad" });
    expect((await res.json()).error).toBe("Enter the emergency contact's 10-digit mobile number, starting with 6, 7, 8 or 9.");

    res = await request.post(`${BASE}/api/tenants`, { headers: oAuth, data: { name: "Bad", phone: "5845012345" } });
    expect(res.status()).toBe(400);

    res = await request.post(`${BASE}/tenant-auth/login`, { data: { phone: "abc", password: PASSWORD } });
    expect(res.status()).toBe(400);

    // And the form says so before sending anything.
    await loginAs(page, ownerToken);
    await page.goto("/tenants/new");
    await page.getByLabel(/^Full name/).fill("Typo Phone");
    await page.getByLabel(/^Phone/).fill("98450");
    await page.locator("form button[type=submit]").click();
    await expect(page.getByText("Enter a 10-digit mobile number starting with 6, 7, 8 or 9.")).toBeVisible();
  });
});
