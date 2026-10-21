import { test, expect } from "@playwright/test";
import { dueChip, dueLine, daysUntil } from "../../src/lib/due";

const today = "2026-10-21";

test("the panel line says each state in one line", () => {
  expect(dueLine({ due_date: "2026-10-31", due_paise: 600000, due_state: "upcoming" }))
    .toEqual({ text: "Next rent ₹6,000 due 31 Oct", tone: "neutral" });
  expect(dueLine({ due_date: "2026-10-15", due_paise: 650000, due_state: "overdue" }))
    .toEqual({ text: "Overdue since 15 Oct", tone: "danger" });
  expect(dueLine({ due_date: "2026-10-21", due_paise: 550000, due_state: "due_today" }))
    .toEqual({ text: "Rent ₹5,500 due today", tone: "warning" });
  expect(dueLine({ due_date: "2027-01-15", due_paise: 850000, due_state: "paid_ahead" }))
    .toEqual({ text: "Paid up to 15 Jan", tone: "neutral" });
  expect(dueLine({})).toBeNull();
});

test("a tile shows a date only when it is worth acting on", () => {
  expect(dueChip({ due_date: "2026-10-15", due_state: "overdue" }, today)).toEqual({ text: "due 15 Oct", tone: "danger" });
  expect(dueChip({ due_date: "2026-10-21", due_state: "due_today" }, today)).toEqual({ text: "due today", tone: "warning" });
  expect(dueChip({ due_date: "2026-10-28", due_state: "upcoming" }, today)).toEqual({ text: "due 28 Oct", tone: "warning" });
  // Eight days out is next week's problem, and paid ahead is no problem.
  expect(dueChip({ due_date: "2026-10-29", due_state: "upcoming" }, today)).toBeNull();
  expect(dueChip({ due_date: "2026-11-15", due_state: "paid_ahead" }, today)).toBeNull();
});

test("days until counts calendar days across a month end", () => {
  expect(daysUntil("2026-11-02", "2026-10-30")).toBe(3);
  expect(daysUntil("2026-10-21", "2026-10-21")).toBe(0);
});
