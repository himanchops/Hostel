import { test, expect } from "@playwright/test";
import { registerOwnerId } from "../../src/lib/registerOwner";

/**
 * Whose form a bare /register shows (Oct 2026). Only a plain whole number
 * names an owner; anything else is NaN, the "link doesn't work" card, so a
 * typo in the Vercel setting can't hand registrations to another owner.
 */

test("a plain number names that owner", () => {
  expect(registerOwnerId("4")).toBe(4);
  expect(registerOwnerId(" 12 ")).toBe(12);
});

test("unset or blank names nobody", () => {
  expect(registerOwnerId(undefined)).toBeNaN();
  expect(registerOwnerId("")).toBeNaN();
  expect(registerOwnerId("  ")).toBeNaN();
});

test("anything that is not a plain positive number names nobody", () => {
  // parseInt would read "4a" as 4 and "4.5" as 4.
  for (const raw of ["4a", "4.5", "0", "-4", "04", "four", "1e2"]) {
    expect(registerOwnerId(raw), raw).toBeNaN();
  }
});
