import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `del-${Date.now()}`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A bed with a stay and a payment behind it — the exact shape a cascading
 * DELETE would destroy: beds → stays → payments, every link ON DELETE CASCADE.
 */
async function seedLedger(request: APIRequestContext, token: string, suffix: string) {
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${suffix}`);
  const tenant = await createTenantViaApi(request, token, {
    name: "Ledger Holder",
    phone: `98453${Math.floor(Math.random() * 90000 + 10000)}`,
  });

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  const stayRes = await request.post(`${BASE}/api/stays`, {
    headers: auth,
    data: {
      tenant_id: tenant.id,
      bed_id: bedId,
      rent_amount: 800000,
      deposit_amount: 0,
      rent_cycle: "monthly",
      start_date: isoDate(start),
    },
  });
  expect(stayRes.ok()).toBeTruthy();
  const stay = await stayRes.json();

  const payRes = await request.post(`${BASE}/api/stays/${stay.id}/payments`, {
    headers: auth,
    data: { amount: 800000, payment_type: "cash", payment_date: isoDate(start) },
  });
  expect(payRes.ok()).toBeTruthy();

  return { siteId, roomId, bedId, stay, auth };
}

test.describe("Deleting a bed or room cannot destroy a ledger", () => {
  test("an occupied bed refuses deletion, and says what it is protecting", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-bed`);
    const { siteId, roomId, bedId, auth } = await seedLedger(request, token, "bed");

    const res = await request.delete(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds/${bedId}`,
      { headers: auth },
    );

    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("1 stay");
    expect(body.error).toContain("1 payment");

    // And it is genuinely still there — a refusal that half-deleted would be
    // worse than the bug.
    const beds = await request.get(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth });
    expect((await beds.json()).some((b: { id: number }) => b.id === bedId)).toBeTruthy();
  });

  test("the room above it refuses too, rather than cascading through", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-room`);
    const { siteId, roomId, auth } = await seedLedger(request, token, "room");

    const res = await request.delete(`${BASE}/api/sites/${siteId}/rooms/${roomId}`, { headers: auth });

    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("stay");

    const rooms = await request.get(`${BASE}/api/sites/${siteId}/rooms`, { headers: auth });
    expect((await rooms.json()).some((r: { id: number }) => r.id === roomId)).toBeTruthy();
  });

  test("a stay that has ENDED still protects the bed", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-ended`);
    const { siteId, roomId, bedId, stay, auth } = await seedLedger(request, token, "ended");

    const ended = await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { end_date: isoDate(new Date()) },
    });
    expect(ended.ok()).toBeTruthy();

    // "They moved out" is not a reason to let the ledger be destroyed — a
    // former tenant's payment history is exactly the record worth keeping.
    const res = await request.delete(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds/${bedId}`,
      { headers: auth },
    );
    expect(res.status()).toBe(409);
  });

  test("a bed nobody has ever used still deletes cleanly", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-clean`);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, roomId } = await createSiteRoomBed(request, token, `${RUN_ID}-clean`);

    const made = await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, {
      headers: auth,
      data: { name: "Spare" },
    });
    const bed = await made.json();

    const res = await request.delete(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds/${bed.id}`,
      { headers: auth },
    );
    expect(res.status()).toBe(200);
  });

  test("the UI shows the server's reason, not a generic failure", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-ui`);
    const { siteId, roomId } = await seedLedger(request, token, "ui");

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}`);

    // Expand the room so its beds render.
    await page.getByRole("button", { name: /Room 1/ }).first().click();

    // The remove button only exists on hover (`hidden … group-hover:inline`),
    // so the chip has to be hovered before the × is clickable at all.
    const chip = page.locator(`[data-testid="bed-chip"]`).first();
    await chip.hover();
    await chip.getByRole("button", { name: /^Remove bed/ }).click();

    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // The refusal reaches the owner in the server's own words.
    await expect(page.getByText(/would destroy that ledger/i)).toBeVisible();

    // And the bed is still on screen afterwards.
    await expect(chip).toBeVisible();
    expect(roomId).toBeTruthy();
  });
});
