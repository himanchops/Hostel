import { test, expect } from "@playwright/test";
import { cycleStart, firstDueOnOrAfter, nextDueDate } from "../../src/lib/rent";

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
