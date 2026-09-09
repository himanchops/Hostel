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

  /**
   * The dialog used to state the rule and then offer a red Delete button
   * underneath it, because the page could not tell which case it was in — so
   * the only way to discover the refusal was to press the button. Now the
   * footprint arrives with the bed, and the dialog explains instead of asking.
   */
  test("a bed with history is never offered a Delete button", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-ui`);
    const { siteId } = await seedLedger(request, token, "ui");

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}`);
    await page.getByRole("button", { name: /Room 1/ }).first().click();

    const chip = page.locator(`[data-testid="bed-chip"]`).first();
    await expect(chip).toBeVisible();

    // The control names its own outcome before it is pressed.
    await chip.getByRole("button", { name: /^Why bed .* cannot be removed/ }).click();

    await expect(page.getByText(/cannot be deleted/i)).toBeVisible();
    await expect(page.getByText(/1 stay and 1 payment on record/i)).toBeVisible();

    // The whole point: no button that would have failed.
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "OK" }).click();
    await expect(chip).toBeVisible();
  });

  test("a bed with no history still gets a real confirm", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-ui-clean`);
    const auth = { Authorization: `Bearer ${token}` };
    const { siteId, roomId } = await createSiteRoomBed(request, token, `${RUN_ID}-ui-clean`);
    await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, {
      headers: auth,
      data: { name: "Spare" },
    });

    await loginAs(page, token);
    await page.goto(`/sites/${siteId}`);
    await page.getByRole("button", { name: /Room 1/ }).first().click();

    const spare = page.locator(`[data-testid="bed-chip"]`).filter({ hasText: "Spare" });
    await spare.getByRole("button", { name: "Remove bed Spare" }).click();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(spare).toHaveCount(0);
  });
  /**
   * The counts the list endpoints report and the rule the DELETE enforces are
   * two pieces of SQL that must never disagree. If they drift, the page starts
   * either offering a delete that 409s (the wart this replaced) or hiding one
   * that would have worked.
   *
   * So this asserts the agreement directly rather than the counts' values:
   * whatever the list says is deletable must delete, and whatever it says is
   * not must be refused.
   */
  test("the reported footprint agrees with what DELETE actually does", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-agree`);
    const { siteId, roomId, bedId, auth } = await seedLedger(request, token, "agree");

    // A second bed in the same room that nobody has ever used.
    const freshRes = await request.post(`${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, {
      headers: auth,
      data: { name: "Untouched" },
    });
    const fresh = await freshRes.json();
    expect(fresh.stay_count).toBe(0);
    expect(fresh.payment_count).toBe(0);

    const beds = await (await request.get(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth },
    )).json();

    for (const bed of beds) {
      const res = await request.delete(
        `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds/${bed.id}`, { headers: auth },
      );
      if (bed.stay_count === 0) {
        expect(res.status(), `bed ${bed.name} reported deletable`).toBe(200);
      } else {
        expect(res.status(), `bed ${bed.name} reported ${bed.stay_count} stays`).toBe(409);
      }
    }

    // The occupied bed survived, so the room still reports a footprint — and
    // the room's counts aggregate its beds rather than counting one of them.
    const rooms = await (await request.get(
      `${BASE}/api/sites/${siteId}/rooms`, { headers: auth },
    )).json();
    const room = rooms.find((r: { id: number }) => r.id === roomId);
    expect(room.stay_count).toBe(1);
    expect(room.payment_count).toBe(1);

    const roomDelete = await request.delete(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}`, { headers: auth },
    );
    expect(roomDelete.status()).toBe(409);

    // And the bed is still there with its ledger intact.
    const after = await (await request.get(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds`, { headers: auth },
    )).json();
    expect(after.map((b: { id: number }) => b.id)).toContain(bedId);
  });

  /**
   * A rename must not hand back a row that looks deletable. The response
   * replaces the row in the page's state, so a stripped-down one would quietly
   * re-enable the delete the guard exists to prevent.
   */
  test("renaming a bed with history keeps its footprint in the response", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-rename`);
    const { siteId, roomId, bedId, auth } = await seedLedger(request, token, "rename");

    const renamed = await (await request.put(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}/beds/${bedId}`,
      { headers: auth, data: { name: "Renamed With History" } },
    )).json();

    expect(renamed.name).toBe("Renamed With History");
    expect(renamed.stay_count).toBe(1);
    expect(renamed.payment_count).toBe(1);

    const renamedRoom = await (await request.put(
      `${BASE}/api/sites/${siteId}/rooms/${roomId}`,
      { headers: auth, data: { name: "Renamed Room", floor: 3 } },
    )).json();
    expect(renamedRoom.floor).toBe(3);
    expect(renamedRoom.stay_count).toBe(1);
  });
});
