import { test, expect } from "@playwright/test";
import { createOwner, loginAs } from "../helpers/api";

const BASE = "http://localhost:8080";
const RUN_ID = Date.now().toString();

/**
 * The pending queue's third approval option used to read "Approve & collect
 * deposit", explained "Collect a deposit/advance now", and submitted with
 * "Approve & record deposit". It has never recorded a rupee — it saves the
 * terms. Since a settlement now refunds only deposit money actually received
 * (migration 007), those words would leave an owner believing a deposit was on
 * the books when it was not.
 */
test("approving with agreed terms says so, and records no money", async ({ page, request }) => {
  const { token, owner } = await createOwner(request, `terms-${RUN_ID}`);
  const name = `Terms Applicant ${RUN_ID}`;
  const reg = await request.post(`${BASE}/public/register/${owner.id}`, {
    data: { name, phone: `94${RUN_ID.slice(-8)}`, password: "applicant1" },
  });
  expect(reg.ok()).toBeTruthy();
  const applicant = await reg.json();

  await loginAs(page, token);
  await page.goto("/pending");
  await page.getByRole("button", { name: new RegExp(name) }).first().click();

  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Approve", exact: true }).click();
  await drawer.getByRole("radio", { name: /Approve & agree terms/ }).check();

  // No promise of money anywhere in the step.
  await expect(drawer).not.toContainText(/collect (a )?deposit|record deposit/i);
  await expect(drawer).toContainText("Record the deposit as a payment once it is paid");

  await drawer.getByLabel(/^Monthly rent/).fill("8000");
  await drawer.getByLabel(/^Deposit/).fill("16000");
  await drawer.getByRole("button", { name: "Approve & save terms" }).click();
  await expect(page.getByText(`${name} approved`)).toBeVisible();

  // The terms were saved; no money was. The tenant page says both.
  await page.goto(`/tenants/${applicant.id}`);
  await expect(page.getByText("Deposit ₹16,000 agreed · ₹0 received")).toBeVisible();
  await expect(page.getByRole("button", { name: /ledger/i })).toContainText("0 payments");
});
