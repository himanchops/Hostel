import { test, expect } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The owner's 27 Oct 2026 choices: the Tenants list says the room, when they
 * moved in and what they owe ("Since" was when the record was typed in), and
 * a WhatsApp reminder says where to pay once a UPI ID is set on Account.
 */
test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

function firstOfMonth(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

test("the Tenants list shows room, moved in and owes; reminders carry the UPI ID", async ({ page, request }) => {
  const { token } = await createOwner(request, `tl-${RUN_ID}`);
  const auth = { Authorization: `Bearer ${token}` };
  const { bedId } = await createSiteRoomBed(request, token, `tl-${RUN_ID}`);

  // Two months billed from the 1st of last month, one paid: owes ₹6,000.
  const owing = await createTenantViaApi(request, token, { name: "Owes Rent", phone: "9812800001" });
  const start = firstOfMonth(-1);
  const stay = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: owing.id, bed_id: bedId, rent_amount: 600000, deposit_amount: 0, rent_cycle: "monthly", start_date: start },
  })).json();
  await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
    headers: auth, data: { amount: 600000, payment_type: "cash", payment_date: start },
  });
  await createTenantViaApi(request, token, { name: "No Stay", phone: "9812800002" });
  // One who stayed last month and left on the 10th.
  const leaver = await createTenantViaApi(request, token, { name: "Moved Away", phone: "9812800003" });
  const { bedId: bed2 } = await createSiteRoomBed(request, token, `tl2-${RUN_ID}`);
  const gone = await (await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: { tenant_id: leaver.id, bed_id: bed2, rent_amount: 500000, deposit_amount: 0, rent_cycle: "monthly", start_date: firstOfMonth(-2) },
  })).json();
  const leftOn = firstOfMonth(-1).slice(0, 8) + "10";
  const ended = await request.put(`${BASE}/api/stays/${gone.id}`, { headers: auth, data: { end_date: leftOn } });
  expect(ended.ok(), await ended.text()).toBeTruthy();

  await loginAs(page, token);
  await page.goto("/tenants");
  const row = page.getByRole("link", { name: /Owes Rent/ });
  await expect(row).toContainText("Room 1 · Bed A");
  await expect(row).toContainText("₹6,000");
  const [y, m] = start.split("-").map(Number);
  await expect(row).toContainText(new RegExp(`1 \\w{3,4} ${y}`));
  expect(m).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: /No Stay/ })).toContainText("Not staying");
  await expect(page.getByRole("link", { name: /Moved Away/ })).toContainText(/Left 10 \w{3,4} \d{4}/);
  await expect(page.getByText("Since", { exact: true })).toHaveCount(0);

  // The UPI ID: refused when it is not one, saved when it is.
  await page.goto("/account");
  const upi = page.getByLabel("UPI ID");
  await upi.fill("9812800001");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("A UPI ID looks like name@bank, for example rahul@okaxis.")).toBeVisible();
  await upi.fill("hostel.owner@okaxis");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("UPI ID saved. Reminders will include it.")).toBeVisible();
  expect((await (await request.get(`${BASE}/api/me`, { headers: auth })).json()).upi_id).toBe("hostel.owner@okaxis");

  // The reminder says where to pay.
  await page.goto("/payments");
  const href = await page.getByRole("link", { name: "Nudge" }).first().getAttribute("href");
  expect(decodeURIComponent(href!.split("?text=")[1])).toContain("You can pay by UPI to hostel.owner@okaxis. Thank you!");

  // Cleared, the line goes.
  const cleared = await request.put(`${BASE}/api/me/upi`, { headers: auth, data: { upi_id: "" } });
  expect((await cleared.json()).upi_id).toBeNull();
});
