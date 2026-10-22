import { test, expect } from "@playwright/test";
import { dueChip, dueLine, daysUntil, dueSoon, dueWeekday } from "../../src/lib/due";
import { payMethodLabel } from "../../src/lib/payMethod";

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

test("due this week is today and the seven days after, never the overdue", () => {
  expect(dueSoon({ due_date: "2026-10-21", due_state: "due_today" }, today)).toBe(true);
  expect(dueSoon({ due_date: "2026-10-28", due_state: "upcoming" }, today)).toBe(true);
  expect(dueSoon({ due_date: "2026-10-29", due_state: "upcoming" }, today)).toBe(false);
  // Overdue has its own list, above this one.
  expect(dueSoon({ due_date: "2026-10-15", due_state: "overdue" }, today)).toBe(false);
  expect(dueSoon({ due_date: "2026-10-25", due_state: "paid_ahead" }, today)).toBe(false);
  expect(dueSoon({}, today)).toBe(false);
});

test("a date this week reads with its weekday", () => {
  expect(dueWeekday("2026-10-24")).toBe("Sat, 24 Oct");
  expect(dueWeekday("2026-11-02")).toBe("Mon, 2 Nov");
});

test("money that arrived online is labelled UPI", () => {
  expect(payMethodLabel("online")).toBe("UPI");
  expect(payMethodLabel("cash")).toBe("Cash");
  expect(payMethodLabel(undefined)).toBe("");
});
