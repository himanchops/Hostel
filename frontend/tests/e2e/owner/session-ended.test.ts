import { test, expect } from "@playwright/test";
import { createOwner, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * A session that ended mid-form said "invalid token" and nothing else. The
 * only way out was a reload, which threw away a half-typed tenant profile —
 * and the login page it led to never said why, or took you back (UX audit
 * M10). Now the form keeps what was typed, a dialog signs the same owner back
 * in on the spot, and a cold load remembers where it was going.
 */
test.describe("When the session ends", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test("mid-form, signing in again keeps what was typed", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `ended-a-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto("/tenants/new");

    await page.getByLabel("Full name").fill(`Half Typed ${RUN_ID}`);
    await page.getByLabel(/^Phone/).fill(`98${RUN_ID.slice(-8)}`);

    // Elsewhere — another device — the owner signs out everywhere.
    const out = await request.post(`${BASE}/api/me/sign-out-everywhere`, { headers: { Authorization: `Bearer ${token}` } });
    expect(out.ok()).toBeTruthy();

    await page.getByRole("button", { name: "Create tenant" }).tap();
    const dialog = page.getByRole("dialog", { name: "You were signed out" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/invalid token/i)).toHaveCount(0);
    await expect(page.getByText(/what you typed is still here/)).toBeVisible();
    await expect(dialog.getByLabel("Email")).toHaveValue(owner.email);

    await dialog.getByLabel("Password").fill("testpassword123");
    await dialog.getByRole("button", { name: "Sign in" }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Signed in again — carry on where you were")).toBeVisible();

    // Nothing was lost, and the save goes through on the new session.
    await expect(page.getByLabel("Full name")).toHaveValue(`Half Typed ${RUN_ID}`);
    await page.getByRole("button", { name: "Create tenant" }).tap();
    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    await expect(page.getByText(`Half Typed ${RUN_ID}`).first()).toBeVisible();
  });

  test("a wrong password in the dialog says so, and the dialog stays", async ({ page, request }) => {
    const { token } = await createOwner(request, `ended-b-${RUN_ID}`);
    await loginAs(page, token);
    await page.goto("/tenants");
    // Signed in and settled before the session is revoked underneath it.
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();
    await request.post(`${BASE}/api/me/sign-out-everywhere`, { headers: { Authorization: `Bearer ${token}` } });

    // Moving within the app — not a reload, which is a cold start and goes
    // to /login — so the next request is the one that finds out.
    await page.getByRole("link", { name: "Sites" }).first().tap();
    const dialog = page.getByRole("dialog", { name: "You were signed out" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Password").fill("not-the-password");
    await dialog.getByRole("button", { name: "Sign in" }).tap();
    await expect(dialog.getByText("invalid email or password")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("on a cold load, signing in goes back to where you were", async ({ page, request }) => {
    const { owner } = await createOwner(request, `ended-c-${RUN_ID}`);

    await page.goto("/collections?from=bookmark");
    await expect(page).toHaveURL(/\/login\?next=%2Fcollections%3Ffrom%3Dbookmark$/);
    await expect(page.getByText("Sign in to carry on where you were.")).toBeVisible();

    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByRole("button", { name: "Sign in" }).tap();
    await expect(page).toHaveURL(/\/collections\?from=bookmark$/);
  });

  test("next never leaves the site", async ({ page, request }) => {
    const { owner } = await createOwner(request, `ended-d-${RUN_ID}`);
    await page.goto("/login?next=//evil.example/steal");
    await expect(page.getByText("Sign in to carry on where you were.")).toHaveCount(0);
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByRole("button", { name: "Sign in" }).tap();
    await expect(page).toHaveURL(/localhost:3000\/dashboard$/);
  });
});
