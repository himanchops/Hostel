import { test, expect } from "@playwright/test";
import { createOwner } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The registration page is the one screen in the product a stranger sees, and
 * they see it on a phone — pointed at a QR code in a corridor. So this whole
 * file runs at 375px rather than testing mobile as an afterthought.
 */
test.use({ viewport: { width: 375, height: 812 } });

test.describe("Public registration", () => {
  test("the public owner endpoint gives a name and nothing else", async ({ request }) => {
    const { owner } = await createOwner(request, `pub-owner-${RUN_ID}`);

    const res = await request.get(`${BASE}/public/owners/${owner.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.name).toBe(owner.name);
    // Owner ids are small integers and therefore enumerable. This endpoint is
    // a directory of hostel names; it must never become a directory of contact
    // details. Asserting the exact key set fails the moment a field is added.
    expect(Object.keys(body)).toEqual(["name"]);

    const missing = await request.get(`${BASE}/public/owners/999999999`);
    expect(missing.status()).toBe(404);
  });

  test("a stranger registers end-to-end at 375px", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-reg-${RUN_ID}`);
    const applicant = `Priya Nair ${RUN_ID}`;
    const phone = `9${RUN_ID.slice(-9)}`;

    await page.goto(`/register/${owner.id}`);

    // The trust signal: the page names the property you are registering with.
    // Without it the form is indistinguishable from a phishing page.
    await expect(page.getByRole("heading", { name: `Register with ${owner.name}` })).toBeVisible();

    await page.getByPlaceholder("Your full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(phone);
    await page.getByPlaceholder("Company or college name").fill("Zoho");
    await page.getByPlaceholder("Min. 6 characters").fill("testpassword123");

    // Nothing may overflow the viewport on the way down — this page is long and
    // the whole point is that it survives a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);

    await page.getByRole("button", { name: "Submit registration" }).click();

    // The success screen: what happened, and what happens next.
    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();
    await expect(page.getByText(`Your details have gone to ${owner.name} for review.`)).toBeVisible();
    await expect(page.getByText("The owner checks your details and assigns you a bed.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the tenant portal →" })).toHaveAttribute(
      "href",
      "/my/login"
    );

    // And it actually reached the owner's pending queue with the details typed.
    const pending = await request.get(`${BASE}/api/tenants?pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pending.status()).toBe(200);
    const rows = await pending.json();
    const created = rows.find((t: { name: string }) => t.name === applicant);
    expect(created).toBeTruthy();
    expect(created.phone).toBe(phone);
    expect(created.workplace).toBe("Zoho");
    expect(created.is_approved).toBe(false);
  });

  // A name that fails to load costs the header its property name and nothing
  // else — the form still has to work, because the applicant is standing there.
  test("registration still works when the owner name cannot be fetched", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-degrade-${RUN_ID}`);
    const applicant = `Degraded ${RUN_ID}`;

    await page.route("**/public/owners/*", (route) => route.abort());
    await page.goto(`/register/${owner.id}`);

    await expect(page.getByRole("heading", { name: "Tenant registration" })).toBeVisible();

    await page.getByPlaceholder("Your full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`8${RUN_ID.slice(-9)}`);
    await page.getByPlaceholder("Min. 6 characters").fill("testpassword123");
    await page.getByRole("button", { name: "Submit registration" }).click();

    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();
    await expect(page.getByText("Your details have gone to the owner for review.")).toBeVisible();

    const pending = await request.get(`${BASE}/api/tenants?pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await pending.json()).some((t: { name: string }) => t.name === applicant)).toBe(true);
  });
  /**
   * The photo field: the tenant is standing there with a phone, which is the
   * cheapest moment in the whole system to get a face on the record. The column
   * and the owner-side field both already existed; the public form simply never
   * asked, and the payload carried no `photo_url` at all.
   */
  test("a photo taken at registration reaches the owner's record", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-photo-${RUN_ID}`);
    const applicant = `Photo Person ${RUN_ID}`;

    await page.goto(`/register/${owner.id}`);

    await page.getByPlaceholder("Your full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`7${RUN_ID.slice(-9)}`);
    await page.getByPlaceholder("Min. 6 characters").fill("testpassword123");

    // A 1×1 PNG, built here rather than committed: the assertion is about the
    // upload round-trip, not about the pixels.
    await page.getByLabel(/Your photo/).setInputFiles({
      name: "selfie.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });

    // The filename echoed back is the only confirmation this page can give
    // someone who just picked a file out of a camera roll.
    await expect(page.getByText(/selfie\.png/)).toBeVisible();

    await page.getByRole("button", { name: "Submit registration" }).click();
    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();

    const pending = await request.get(`${BASE}/api/tenants?pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const created = (await pending.json()).find((t: { name: string }) => t.name === applicant);
    expect(created.photo_url).toBeTruthy();
  });

  /**
   * The owner asked "what email does the tenant log in with, if email is
   * optional?" — a reasonable question that the form invited and never
   * answered. They do not: portal login is phone + password, and email takes
   * no part in authentication at all.
   */
  test("the form says plainly that the phone number is the login", async ({ page, request }) => {
    const { owner } = await createOwner(request, `pub-hint-${RUN_ID}`);
    await page.goto(`/register/${owner.id}`);

    await expect(
      page.getByText("For contact only — you sign in with your phone number.")
    ).toBeVisible();

    // And the password hint names the number they just typed.
    await page.getByPlaceholder("10-digit number").fill("9876500000");
    await expect(page.getByText(/sign in to your tenant portal with your phone number \(9876500000\)/)).toBeVisible();
  });

  test("the portal login page says it too", async ({ page }) => {
    await page.goto("/my/login");
    await expect(page.getByText("Sign in with your phone number — not your email.")).toBeVisible();
  });
});
