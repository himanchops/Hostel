import { test, expect, type Page } from "@playwright/test";
import { createOwner, TEST_ID_KEY, TEST_EMERGENCY, TEST_RULES } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The QR registration form, from four board items (owner, 27 Oct 2026): a
 * wrong link says so before anyone fills anything in, the Aadhaar field
 * takes digits, each error sits under its own field with the focus on it,
 * and the password can be shown.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function fillValid(page: Page, phone: string) {
  await page.getByLabel("Full name").fill("Form Tester");
  await page.getByPlaceholder("10-digit number").fill(phone);
  await page.getByLabel("Emergency contact").fill("Test Parent");
  await page.getByLabel("Their phone").fill("9000000001");
  await page.getByLabel("ID front").setInputFiles({ name: "id.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel(/^Password/).fill("tenant1234");
}

test("a wrong link says so instead of showing the form", async ({ page }) => {
  await page.goto("/register/999999999");
  await expect(page.getByText("This registration link doesn't work.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit registration" })).toHaveCount(0);
});

test("Aadhaar takes digits; each error sits at its field, with the focus", async ({ page, request }) => {
  const { owner } = await createOwner(request, `regform-${RUN_ID}`);
  await page.goto(`/register/${owner.id}`);
  await fillValid(page, `9${RUN_ID.slice(-9)}`);

  const aadhaar = page.getByLabel("Aadhaar number");
  await aadhaar.fill("1234 abcd 5678");
  await expect(aadhaar).toHaveValue("1234  5678");

  await page.getByRole("button", { name: "Submit registration" }).tap();
  await expect(page.getByText("An Aadhaar number has 12 digits.")).toBeVisible();
  await expect(aadhaar).toBeFocused();

  await aadhaar.fill("1234 5678 9012");
  await page.getByPlaceholder("10-digit number").fill("1234567899");
  await page.getByRole("button", { name: "Submit registration" }).tap();
  await expect(page.getByText("Enter a 10-digit mobile number", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("10-digit number")).toBeFocused();
  await expect(page.getByText("An Aadhaar number has 12 digits.")).toHaveCount(0);

  // The server holds the same line for anyone who skips the page.
  const res = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name: "Api Tester", phone: `8${RUN_ID.slice(-9)}`, password: "tenant1234", id_proof_front_url: TEST_ID_KEY, aadhaar_number: "12ab", ...TEST_EMERGENCY, ...TEST_RULES },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("An Aadhaar number has 12 digits.");
});

test("every password field can be shown", async ({ page, request }) => {
  const { owner } = await createOwner(request, `regpw-${RUN_ID}`);
  for (const path of [`/register/${owner.id}`, "/login", "/signup", "/my/login"]) {
    await page.goto(path);
    const field = page.getByLabel(/^Password/);
    await expect(field).toHaveAttribute("type", "password");
    await page.getByLabel("Show password").check();
    await expect(field).toHaveAttribute("type", "text");
  }
});
