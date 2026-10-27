import { test, expect } from "@playwright/test";
import { changedLine, changedTag } from "../../src/lib/paymentEdit";
import type { Payment } from "../../src/lib/api";

// What a corrected payment said before, in one line, naming only what moved.
const now: Payment = {
  id: 1, stay_id: 1, amount: 800000, payment_type: "online", kind: "rent",
  payment_date: "2026-10-05T00:00:00Z", notes: "fixed", is_approved: true,
  from_tenant: false, created_at: "2026-10-05T10:00:00Z",
};

test("a payment never changed has no line", () => {
  expect(changedLine(now)).toBe(null);
  expect(changedTag(now)).toBe(null);
});

test("only what moved is named", () => {
  const p = { ...now, last_edit: {
    amount: 750000, payment_type: "online" as const, kind: "rent" as const,
    payment_date: "2026-10-05T00:00:00Z", notes: "fixed", edited_at: "2026-10-27T09:30:00Z",
  } };
  expect(changedLine(p)).toBe("Changed 27 Oct 2026 · was ₹7,500");
  expect(changedTag(p)).toBe("Changed 27 Oct 2026");
});

test("every field that moved, in a fixed order", () => {
  const p = { ...now, last_edit: {
    amount: 750000, payment_type: "cash" as const, kind: "deposit" as const,
    payment_date: "2026-10-01T00:00:00Z", notes: undefined, edited_at: "2026-10-27T09:30:00Z",
  } };
  expect(changedLine(p)).toBe("Changed 27 Oct 2026 · was ₹7,500, deposit, Cash, 1 Oct 2026, no note");
});

test("a note that changed is quoted", () => {
  const p = { ...now, notes: "", last_edit: {
    amount: 800000, payment_type: "online" as const, kind: "rent" as const,
    payment_date: "2026-10-05T00:00:00Z", notes: "UPI ref 4411", edited_at: "2026-10-27T09:30:00Z",
  } };
  expect(changedLine(p)).toBe("Changed 27 Oct 2026 · was “UPI ref 4411”");
});

// Saved with nothing different still leaves a dated line rather than "was ".
test("a change that moved nothing says only when", () => {
  const p = { ...now, last_edit: {
    amount: 800000, payment_type: "online" as const, kind: "rent" as const,
    payment_date: "2026-10-05T00:00:00Z", notes: "fixed", edited_at: "2026-10-27T09:30:00Z",
  } };
  expect(changedLine(p)).toBe("Changed 27 Oct 2026");
});
