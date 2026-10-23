import { test, expect } from "@playwright/test";
import { createOwner, createTenantViaApi, loginAs, TEST_ID_KEY } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = `notes-${Date.now()}`;

function phone() {
  return `98${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

/**
 * Notes are the owner's free text about a tenant (migration 012) — what the
 * paper notebook says that no field holds. They are owner-only: a note can say
 * what the owner would not say to the tenant, so the portal must never return
 * one and the public registration form must never write one.
 */
test.describe("Tenant notes", () => {
  test("written on the new-tenant form, shown on the profile, editable and clearable", async ({ page, request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-a`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill("Noted Person");
    await page.getByRole("textbox", { name: "Phone*", exact: true }).fill(phone());
    // Notes sit with the other optional details, folded until wanted.
    await page.getByRole("button", { name: /More about them/ }).click();
    await page.getByLabel("Workplace / College").fill("Night Canteen");
    await page.getByLabel("Notes").fill("Work staff.\nTheir uncle is the reference contact.");
    await page.getByRole("button", { name: "Just add" }).click();
    await page.getByRole("button", { name: "Add tenant" }).click();

    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    // Both lines, as typed: a note is often a list.
    const notes = page.getByText("Work staff.", { exact: false });
    await expect(notes).toBeVisible();
    await expect(notes).toContainText("Their uncle is the reference contact.");
    await expect(page.getByText("Night Canteen")).toBeVisible();

    await page.getByRole("button", { name: "Edit profile" }).click();
    await expect(page.getByLabel("Notes")).toHaveValue("Work staff.\nTheir uncle is the reference contact.");
    await page.getByLabel("Notes").fill("Moved to night shift.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Moved to night shift.")).toBeVisible();
    await expect(page.getByText("Work staff.")).toHaveCount(0);

    await page.getByRole("button", { name: "Edit profile" }).click();
    await page.getByLabel("Notes").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Edit profile" })).toBeVisible();
    await expect(page.getByText("Moved to night shift.")).toHaveCount(0);
    // Workplace was not collateral damage of clearing the notes.
    await expect(page.getByText("Night Canteen")).toBeVisible();
  });

  test("never reach the tenant, at login or in the portal", async ({ request }) => {
    const { token } = await createOwner(request, `${RUN_ID}-b`);
    const tenantPhone = phone();
    const auth = { Authorization: `Bearer ${token}` };
    const created = await request.post(`${BASE}/api/tenants`, {
      headers: auth,
      data: { name: "Kept Private", phone: tenantPhone, notes: "Late twice in September." },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const tenant = await created.json();
    expect(tenant.notes).toBe("Late twice in September.");

    const pw = await request.put(`${BASE}/api/tenants/${tenant.id}/portal-password`, {
      headers: auth,
      data: { password: "corridor42" },
    });
    expect(pw.ok(), await pw.text()).toBeTruthy();

    const login = await request.post(`${BASE}/tenant-auth/login`, {
      data: { phone: tenantPhone, password: "corridor42" },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const session = await login.json();
    expect(JSON.stringify(session)).not.toContain("Late twice");

    const me = await request.get(`${BASE}/tenant/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(me.ok()).toBeTruthy();
    const body = await me.text();
    expect(body).not.toContain("Late twice");
    expect(JSON.parse(body)).not.toHaveProperty("notes");
  });

  test("cannot be written through public registration", async ({ request }) => {
    const { owner, token } = await createOwner(request, `${RUN_ID}-c`);
    const res = await request.post(`${BASE}/public/register/${owner.id}`, {
      data: {
        name: "Self Registered",
        phone: phone(),
        password: "tenant123",
        id_proof_front_url: TEST_ID_KEY,
        notes: "I am a model tenant.",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = await res.json();

    const stored = await request.get(`${BASE}/api/tenants/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await stored.json()).notes).toBeUndefined();
  });

  test("an emergency number with no name still shows on the profile", async ({ page, request }) => {
    // The notebook import brought in second numbers nobody labelled. The
    // profile used to show an emergency contact only when it had a name.
    const { token } = await createOwner(request, `${RUN_ID}-d`);
    const tenant = await createTenantViaApi(request, token, { name: "Unlabelled Second", phone: phone() });
    const put = await request.put(`${BASE}/api/tenants/${tenant.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: tenant.name, phone: tenant.phone, emergency_contact_phone: "9000012345" },
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await loginAs(page, token);
    await page.goto(`/tenants/${tenant.id}`);
    await expect(page.getByText("Emergency contact")).toBeVisible();
    await expect(page.getByText("9000012345")).toBeVisible();
  });
});
