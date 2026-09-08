import { test, expect, type APIRequestContext } from "@playwright/test";
import { createOwner, createSiteRoomBed, createTenantViaApi, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `notice-${Date.now()}`;

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromToday(n: number): string {
  return isoDate(new Date(utcToday().getTime() + n * 86_400_000));
}

/** An owner-created tenant in a bed — the case that has no portal login at all. */
async function seedStay(request: APIRequestContext, token: string, suffix: string, name: string) {
  const auth = { Authorization: `Bearer ${token}` };
  const { siteId, roomId, bedId } = await createSiteRoomBed(request, token, `${RUN_ID}-${suffix}`);
  const tenant = await createTenantViaApi(request, token, {
    name,
    phone: `98454${Math.floor(Math.random() * 90000 + 10000)}`,
  });

  const start = new Date(Date.UTC(utcToday().getUTCFullYear(), utcToday().getUTCMonth() - 2, 1));
  const res = await request.post(`${BASE}/api/stays`, {
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
  expect(res.ok()).toBeTruthy();
  return { siteId, roomId, bedId, tenant, stay: await res.json(), auth };
}

async function gridBed(request: APIRequestContext, auth: Record<string, string>, siteId: number, bedId: number) {
  const res = await request.get(`${BASE}/api/sites/${siteId}/grid`, { headers: auth });
  const body = await res.json();
  const rooms = body.rooms ?? body;
  for (const room of rooms) {
    for (const bed of room.beds) if (bed.id === bedId) return bed;
  }
  throw new Error(`bed ${bedId} not in grid`);
}

test.describe("Recording a vacating notice", () => {
  test("an owner can record one — the capability that was portal-only", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-owner`);
    const { tenant, stay } = await seedStay(request, token, "owner", "Leaving Soon");

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);

    // Nothing recorded yet, so the action offers to create rather than amend.
    await page.getByRole("button", { name: "Record notice" }).click();

    const leaving = daysFromToday(7);
    await page.getByLabel("When are they leaving?").fill(leaving);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(`Leaving ${leaving}`, { exact: true })).toBeVisible();

    // Persisted, and it did NOT end the stay — that is the whole point.
    const after = await request.get(`${BASE}/api/stays/${stay.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await after.json();
    expect(body.expected_end_date?.slice(0, 10)).toBe(leaving);
    expect(body.notice_date).toBeTruthy();
    expect(body.end_date ?? null).toBeNull();
  });

  test("the bed stays occupied and keeps accruing rent", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-accrue`);
    const { siteId, bedId, stay, auth } = await seedStay(request, token, "accrue", "Still Paying");

    const before = await gridBed(request, auth, siteId, bedId);

    await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { notice_date: isoDate(utcToday()), expected_end_date: daysFromToday(7) },
    });

    const after = await gridBed(request, auth, siteId, bedId);

    // Same tenant, same expectation of rent. A notice is a plan, not a move-out.
    expect(after.tenant?.name).toBe(before.tenant?.name);
    expect(after.total_expected).toBe(before.total_expected);
    expect(after.status).toBe("vacating_soon");
  });

  test("once the date passes it becomes departure_due, outranking arrears", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-due`);
    const { siteId, bedId, stay, auth } = await seedStay(request, token, "due", "Overstayer");

    // No payments at all, so this stay is squarely overdue on money.
    expect((await gridBed(request, auth, siteId, bedId)).status).toBe("overdue");

    await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { expected_end_date: daysFromToday(-3) },
    });

    // "Did they actually go?" is the question worth asking before the balance.
    expect((await gridBed(request, auth, siteId, bedId)).status).toBe("departure_due");

    const dash = await request.get(`${BASE}/api/dashboard`, { headers: auth });
    const body = await dash.json();
    expect(body.alerts.departures_due).toBe(1);
    expect(body.vacating_soon[0].days_overdue).toBe(3);
  });

  test("'still here' clears the queue without inventing an end date", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-stay`);
    const { tenant, siteId, bedId, stay, auth } = await seedStay(request, token, "stay", "Changed Mind");

    await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { notice_date: isoDate(utcToday()), expected_end_date: daysFromToday(-2) },
    });
    expect((await request.get(`${BASE}/api/dashboard`, { headers: auth }).then((r) => r.json())).alerts.departures_due).toBe(1);

    // They decided to stay. Clearing the date is how that is said — without it
    // the only way to stop the nag would be to record a departure that never
    // happened, which would corrupt the ledger.
    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole("button", { name: "Update notice" }).click();
    // The explicit control, not an emptied date box — clearing a date input
    // is unreliable, and this is the path a real owner takes.
    await page.getByRole("button", { name: "They're staying" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Was due to leave/)).toHaveCount(0);

    const after = await request.get(`${BASE}/api/dashboard`, { headers: auth }).then((r) => r.json());
    expect(after.alerts.departures_due).toBe(0);

    // And the stay is still open, still occupying the bed.
    expect((await gridBed(request, auth, siteId, bedId)).status).not.toBe("departure_due");
    const s = await request.get(`${BASE}/api/stays/${stay.id}`, { headers: auth }).then((r) => r.json());
    expect(s.end_date ?? null).toBeNull();
  });

  test("an expected departure before the stay began is refused", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-bad`);
    const { stay, auth } = await seedStay(request, token, "bad", "Time Traveller");

    const res = await request.put(`${BASE}/api/stays/${stay.id}`, {
      headers: auth,
      data: { expected_end_date: "2020-01-01" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("before start_date");
  });
});
