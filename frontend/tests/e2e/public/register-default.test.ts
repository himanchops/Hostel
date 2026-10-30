import { test, expect } from "@playwright/test";

/**
 * A bare /register, for the poster's QR and for typing (Oct 2026). Which
 * owner it belongs to is NEXT_PUBLIC_REGISTER_OWNER_ID, read when the dev
 * server starts, so each test runs only in the state the server is in:
 * unset is the default, and the second test runs when the server and this
 * run are both started with it set to an owner that exists.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const configured = process.env.NEXT_PUBLIC_REGISTER_OWNER_ID;

test("with no owner set, /register says the link doesn't work", async ({ page }) => {
  test.skip(!!configured, "NEXT_PUBLIC_REGISTER_OWNER_ID is set for this run");
  await page.goto("/register");
  await expect(page.getByText("This registration link doesn't work.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit registration" })).toHaveCount(0);
});

test("with an owner set, /register is that owner's form", async ({ page, request }) => {
  test.skip(!configured, "set NEXT_PUBLIC_REGISTER_OWNER_ID for the server and this run");
  // An owner with more than one site has no single name, and the header
  // then says "Welcome" alone.
  const { name } = await (await request.get(`http://localhost:8080/public/owners/${configured}`)).json();

  await page.goto("/register");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name ? `Welcome to ${name}` : "Welcome");
  await expect(page.getByRole("button", { name: "Submit registration" })).toBeVisible();
});
