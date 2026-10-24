import { test, expect, type Page } from "@playwright/test";
import { createOwner, TEST_EMERGENCY } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The registration page is the one screen in the product a stranger sees, and
 * they see it on a phone — pointed at a QR code in a corridor. So this whole
 * file runs at 375px rather than testing mobile as an afterthought.
 */
test.use({ viewport: { width: 375, height: 812 } });

// A 1×1 PNG, built here rather than committed: the assertions are about the
// upload round-trip, not about the pixels.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Registration requires the front of an ID; every submitting test attaches one. */
async function attachIdFront(page: Page) {
  await page.getByLabel("ID front").setInputFiles({
    name: "id-front.png",
    mimeType: "image/png",
    buffer: PNG,
  });
}

test.describe("Public registration", () => {
  test("the public owner endpoint gives a name and nothing else", async ({ request }) => {
    const { owner } = await createOwner(request, `pub-owner-${RUN_ID}`);

    const res = await request.get(`${BASE}/public/owners/${owner.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    // No site yet, so no property to name — and never the owner's own name.
    expect(body.name).toBe("");
    // Owner ids are small integers and therefore enumerable. This endpoint is
    // a directory of hostel names; it must never become a directory of contact
    // details. Asserting the exact key set fails the moment a field is added.
    expect(Object.keys(body)).toEqual(["name"]);

    const missing = await request.get(`${BASE}/public/owners/999999999`);
    expect(missing.status()).toBe(404);
  });

  // The header is a trust signal for a stranger at the door, so it names the
  // property, not the account holder. With several sites there is no single
  // property the link belongs to, so it names nobody.
  test("the registration header names the hostel, not its owner", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-site-${RUN_ID}`);
    const auth = { Authorization: `Bearer ${token}` };
    const hostel = `Sunrise PG ${RUN_ID}`;
    await request.post(`${BASE}/api/sites`, { headers: auth, data: { name: hostel } });

    await page.goto(`/register/${owner.id}`);
    await expect(page.getByRole("heading", { name: `Welcome to ${hostel}` })).toBeVisible();
    await expect(page.getByText("Hostel Manager")).toHaveCount(0);

    await request.post(`${BASE}/api/sites`, { headers: auth, data: { name: `Second site ${RUN_ID}` } });
    const body = await (await request.get(`${BASE}/public/owners/${owner.id}`)).json();
    expect(body).toEqual({ name: "" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
  });

  test("a stranger registers end-to-end at 375px", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-reg-${RUN_ID}`);
    const hostel = `Lakeview PG ${RUN_ID}`;
    await request.post(`${BASE}/api/sites`, { headers: { Authorization: `Bearer ${token}` }, data: { name: hostel } });
    const applicant = `Priya Nair ${RUN_ID}`;
    const phone = `9${RUN_ID.slice(-9)}`;

    await page.goto(`/register/${owner.id}`);

    // The trust signal: the page names the property you are registering with.
    // Without it the form is indistinguishable from a phishing page.
    await expect(page.getByRole("heading", { name: `Welcome to ${hostel}` })).toBeVisible();

    await page.getByLabel("Full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(phone);
    await page.getByLabel("Workplace / College").fill("Zoho");
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByLabel("Emergency contact").fill("Test Parent");
    await page.getByLabel("Their phone").fill("9000000001");
    await attachIdFront(page);

    // Nothing may overflow the viewport on the way down — this page is long and
    // the whole point is that it survives a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);

    await page.getByRole("button", { name: "Submit registration" }).click();

    // The success screen: what happened, and what happens next.
    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();
    await expect(page.getByText(`Your details have gone to ${hostel} for review.`)).toBeVisible();
    await expect(page.getByText("The owner checks your details.")).toBeVisible();
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

    await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();

    await page.getByLabel("Full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`8${RUN_ID.slice(-9)}`);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByLabel("Emergency contact").fill("Test Parent");
    await page.getByLabel("Their phone").fill("9000000001");
    await attachIdFront(page);
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

    await page.getByLabel("Full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`7${RUN_ID.slice(-9)}`);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByLabel("Emergency contact").fill("Test Parent");
    await page.getByLabel("Their phone").fill("9000000001");

    await page.getByLabel("Your photo").setInputFiles({
      name: "selfie.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await attachIdFront(page);

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
    expect(created.id_proof_front_url).toBeTruthy();

    // Uploads are private: the database holds a key, and what reaches the
    // owner is a link minted for this read. Locally that is the dev server's
    // /uploads route (links expire only on R2 — see storage_test.go); the
    // point here is that the key round-tripped into a link that opens.
    for (const link of [created.photo_url, created.id_proof_front_url]) {
      expect(link).toMatch(/^https?:\/\/.+\/public\/[0-9a-f]{32}\.png/);
      const file = await request.get(link);
      expect(file.status(), `${link} should open`).toBe(200);
    }
  });

  // A phone camera's 3000–4000px original used to be stored as-is, and every
  // screen that shows the photo downloaded all of it again. The browser now
  // shrinks it to 1600px on the long edge before upload.
  test("a large photo is shrunk before it is uploaded", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-shrink-${RUN_ID}`);
    const applicant = `Big Photo ${RUN_ID}`;
    await page.goto(`/register/${owner.id}`);

    // A 3024×4032 image, the size of the iPhone portrait that prompted this,
    // drawn with noise so it cannot compress to nothing.
    const big = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 3024;
      c.height = 4032;
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = (i * 7) % 255;
        img.data[i + 1] = (i * 13) % 255;
        img.data[i + 2] = (i * 31) % 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    });

    await page.getByLabel("Full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`64${RUN_ID.slice(-8)}`);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByLabel("Emergency contact").fill("Test Parent");
    await page.getByLabel("Their phone").fill("9000000001");
    await page.getByLabel("ID front").setInputFiles({
      name: "id-front.png",
      mimeType: "image/png",
      buffer: Buffer.from(big, "base64"),
    });
    await page.getByRole("button", { name: "Submit registration" }).click();
    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();

    const pending = await request.get(`${BASE}/api/tenants?pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const created = (await pending.json()).find((t: { name: string }) => t.name === applicant);
    expect(created.id_proof_front_url).toMatch(/\.jpg/); // re-encoded as JPEG

    const size = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, created.id_proof_front_url);
    expect(size).toEqual({ w: 1200, h: 1600 });
  });

  /**
   * The owner has to be able to say who is living in the building, and the
   * applicant is standing there with a phone at this moment and no later one.
   * The back and the photo stay optional; owner-created tenants are not held
   * to it.
   */
  test("the front of an ID is required to register", async ({ page, request }) => {
    const { token, owner } = await createOwner(request, `pub-noid-${RUN_ID}`);
    const applicant = `No ID ${RUN_ID}`;

    await page.goto(`/register/${owner.id}`);
    await page.getByLabel("Full name").fill(applicant);
    await page.getByPlaceholder("10-digit number").fill(`6${RUN_ID.slice(-9)}`);
    await page.getByLabel("Password").fill("testpassword123");
    await page.getByLabel("Emergency contact").fill("Test Parent");
    await page.getByLabel("Their phone").fill("9000000001");
    await page.getByRole("button", { name: "Submit registration" }).click();

    // The browser stops the submit at the field, not with a banner at the top.
    const idFront = page.getByLabel("ID front");
    expect(await idFront.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page.getByRole("heading", { name: "You're registered" })).toHaveCount(0);

    // And the API refuses it too, for anything that is not this form.
    const direct = await request.post(`${BASE}/public/register/${owner.id}`, {
      data: { name: applicant, phone: `6${RUN_ID.slice(-9)}`, password: "testpassword123" },
    });
    expect(direct.status()).toBe(400);
    expect((await direct.json()).error).toBe("Add a photo of the front of your ID.");

    const pending = await request.get(`${BASE}/api/tenants?pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await pending.json()).some((t: { name: string }) => t.name === applicant)).toBe(false);
  });

  // The owner wants someone to call for everyone who registers (Oct 2026).
  test("an emergency contact is required to register", async ({ page, request }) => {
    const { owner } = await createOwner(request, `pub-sos-${RUN_ID}`);
    await page.goto(`/register/${owner.id}`);
    for (const label of ["Emergency contact", "Their phone"]) {
      expect(await page.getByLabel(label).evaluate((el: HTMLInputElement) => el.required)).toBe(true);
    }
    // No email: the owner dropped it from the form.
    await expect(page.getByLabel("Email")).toHaveCount(0);

    const direct = await request.post(`${BASE}/public/register/${owner.id}`, {
      data: { name: `No SOS ${RUN_ID}`, phone: `63${RUN_ID.slice(-8)}`, password: "testpassword123", id_proof_front_url: "public/e2e00000000000000000000000000000.jpg" },
    });
    expect(direct.status()).toBe(400);
    expect((await direct.json()).error).toBe("Add an emergency contact and their phone.");
  });

  // Before uploads went private, the only check was the file extension, so a
  // registration could store any host's ".jpg" and the owner's browser would
  // fetch it when the profile rendered — a tracking pixel aimed at one person.
  test("a file reference must be an upload key, not a URL", async ({ request }) => {
    const { owner } = await createOwner(request, `pub-foreign-${RUN_ID}`);
    const res = await request.post(`${BASE}/public/register/${owner.id}`, {
      data: {
        name: `Foreign ${RUN_ID}`,
        phone: `65${RUN_ID.slice(-8)}`,
        password: "testpassword123",
        id_proof_front_url: "https://anywhere.example/pixel.jpg",
        ...TEST_EMERGENCY,
      },
    });
    expect(res.status()).toBe(400);
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

    // Said once, beside the field it is about.
    await expect(page.getByText("You'll sign in with this.")).toBeVisible();
  });

  /**
   * "(optional)" beside most fields read as permission to skip them, so only
   * what is required is marked, with the asterisk the rest of the app uses
   * (Oct 2026). The groups match the owner's Add tenant form.
   */
  test("the form marks what is required and nothing else", async ({ page, request }) => {
    const { owner } = await createOwner(request, `pub-plain-${RUN_ID}`);
    await page.goto(`/register/${owner.id}`);
    await expect(page.getByRole("heading", { name: "ID and emergency contact" })).toBeVisible();
    await expect(page.getByText("(optional)")).toHaveCount(0);
    await expect(page.getByLabel("Aadhaar number")).toHaveAttribute("inputmode", "numeric");
  });

  test("the portal login page says it too", async ({ page }) => {
    await page.goto("/my/login");
    await expect(page.getByText("Sign in with your phone number.", { exact: true })).toBeVisible();
    // Registration asks for no email, so nothing here should mention one.
    await expect(page.getByText(/email/i)).toHaveCount(0);
  });
});
