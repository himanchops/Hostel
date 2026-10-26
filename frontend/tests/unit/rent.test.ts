import { test, expect } from "@playwright/test";
import { cycleStart, firstDueOnOrAfter, nextDueDate, rentForNights, stayNights } from "../../src/lib/rent";

// Same fixture as backend/internal/handlers/rent_test.go: moved in 6 Jun 2026.
test("monthly cycles start on the move-in day each month", () => {
  expect(cycleStart("2026-06-06", 1, "monthly")).toBe("2026-06-06");
  expect(cycleStart("2026-06-06", 5, "monthly")).toBe("2026-10-06");
  expect(cycleStart("2026-06-06", 8, "monthly")).toBe("2027-01-06");
});

test("a month-end move-in clamps to the last day of short months", () => {
  expect(cycleStart("2026-01-31", 2, "monthly")).toBe("2026-02-28");
  expect(cycleStart("2026-01-31", 3, "monthly")).toBe("2026-03-31");
});

test("the next due date is the first one after today", () => {
  expect(nextDueDate("2026-06-06", "monthly", "2026-10-21")).toBe("2026-11-06");
  // On a due date, that cycle has already begun.
  expect(nextDueDate("2026-06-06", "monthly", "2026-11-06")).toBe("2026-12-06");
  expect(nextDueDate("2026-10-19", "weekly", "2026-10-21")).toBe("2026-10-26");
});

test("a mid-cycle date takes effect from the next due date", () => {
  expect(firstDueOnOrAfter("2026-06-06", "monthly", "2026-08-20")).toBe("2026-09-06");
  expect(firstDueOnOrAfter("2026-06-06", "monthly", "2026-09-06")).toBe("2026-09-06");
});

test("a daily guest's nights stop the day before they leave", () => {
  expect(stayNights("daily", "2026-10-26", "2026-10-31")).toBe(5);
  // Across a month end, and one night.
  expect(stayNights("daily", "2026-10-30", "2026-11-03")).toBe(4);
  expect(stayNights("daily", "2026-10-26", "2026-10-27")).toBe(1);
  // Only daily stays are counted in nights; a date before arrival is none.
  expect(stayNights("monthly", "2026-10-26", "2026-11-26")).toBe(0);
  expect(stayNights("daily", "2026-10-26", "2026-10-20")).toBe(0);
  expect(stayNights("daily", "2026-10-26", "")).toBe(0);
});

test("the whole stay is priced per night", () => {
  expect(rentForNights("550", 5)).toBe("2750");
  // Paise survive: ₹333.33 × 3 is ₹999.99, not a float's 999.9899….
  expect(rentForNights("333.33", 3)).toBe("999.99");
  expect(rentForNights("", 5)).toBe("");
  expect(rentForNights("550", 0)).toBe("");
});
