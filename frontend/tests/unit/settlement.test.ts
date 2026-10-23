import { test, expect } from "@playwright/test";
import { refundFor, parseRupees, cycleCountLabel, advanceHeld } from "../../src/lib/settlement";
import { formatCurrency } from "../../src/lib/api";

// The drawer recomputes the refund on every keystroke while the server
// recomputes it on submit and rejects a mismatch. These two implementations
// have to agree exactly — the numbers below are the same fixture as
// backend/internal/handlers/settlements_test.go, so a change to one that is not
// made to the other fails on both sides.
//
//   ₹17,000 deposit held, ₹8,500 outstanding rent
//   − ₹500 damaged chair − ₹1,200 electricity + ₹300 advance returned
//   = ₹7,100 back to the tenant

test("refund is deposit minus dues plus adjustments", () => {
  expect(
    refundFor(1700000, 850000, 0, [
      { label: "Damaged chair", amount_paise: -50000 },
      { label: "Unpaid electricity share", amount_paise: -120000 },
      { label: "June advance returned", amount_paise: 30000 },
    ])
  ).toBe(710000);
});

test("no adjustments leaves deposit minus dues", () => {
  expect(refundFor(1700000, 850000, 0, [])).toBe(850000);
  expect(refundFor(1700000, 0, 0, [])).toBe(1700000);
});

// ─── A rent advance is the owner's decision, not the formula's ───────────────

test("advance held is the overpayment, and owing rent is not a negative one", () => {
  expect(advanceHeld(-850000)).toBe(850000);
  expect(advanceHeld(850000)).toBe(0);
  expect(advanceHeld(0)).toBe(0);
});

// The same ₹8,500 advance, three legitimate answers. If this were derived from
// the sign of dues instead of passed in, only the first would be reachable and
// the app would be quietly deciding for the owner.
test("all, part, or none of the advance comes back", () => {
  expect(refundFor(1700000, -850000, 850000, [])).toBe(2550000); // all
  expect(refundFor(1700000, -850000, 425000, [])).toBe(2125000); // half
  expect(refundFor(1700000, -850000, 0, [])).toBe(1700000);      // none
});

// Withholding an advance and deducting for damage are separate decisions and
// have to compose.
test("a withheld advance still takes adjustments", () => {
  expect(refundFor(1700000, -850000, 0, [{ label: "Damaged chair", amount_paise: -50000 }]))
    .toBe(1650000);
});

// Outstanding rent is withheld; a negative dues must never also subtract.
test("only positive dues reduce the refund", () => {
  expect(refundFor(1700000, 850000, 0, [])).toBe(850000);
  expect(refundFor(1700000, -850000, 0, [])).toBe(1700000);
});

// Deductions larger than the deposit mean the tenant leaves owing money. The
// sign has to survive to the screen: an owner shown ₹11,500 when the tenant
// owes ₹11,500 hands over cash they should be collecting.
test("refund goes negative when the tenant owes", () => {
  const refund = refundFor(1700000, 2550000, 0, [{ label: "Broken window", amount_paise: -300000 }]);
  expect(refund).toBe(-1150000);
  expect(formatCurrency(refund)).toBe("-₹11,500");
});

// ─── Parsing what the owner types ────────────────────────────────────────────

test("plain amounts convert to paise", () => {
  expect(parseRupees("500")).toBe(50000);
  expect(parseRupees("0")).toBe(0);
  expect(parseRupees(" 1200 ")).toBe(120000);
});

// Every other screen renders ₹1,200 with the comma, so the owner types it back
// that way. parseFloat("1,200") is 1 — this is the bug that would turn a
// ₹1,200 deduction into ₹1 with nothing on screen to show for it.
test("commas are accepted, the Indian way too", () => {
  expect(parseRupees("1,200")).toBe(120000);
  expect(parseRupees("1,00,000")).toBe(10000000);
});

// 12.35 * 100 is 1234.9999999999998 in binary floating point. Truncating there
// loses a paisa; rounding does not.
test("paise survive the conversion", () => {
  expect(parseRupees("12.35")).toBe(1235);
  expect(parseRupees("0.01")).toBe(1);
  expect(parseRupees("99.99")).toBe(9999);
});

// The sign comes from the Deduct/Add choice, not from the text box. Accepting a
// typed minus as well would let "Deduct" and "−500" cancel into a credit.
test("anything that is not a plain positive amount is rejected", () => {
  for (const bad of ["", "   ", "-500", "abc", "5.005", "1.2.3", "₹500", "500rs", "1e3", "NaN"]) {
    expect(parseRupees(bad), `parseRupees(${JSON.stringify(bad)})`).toBeNull();
  }
});

// ─── The working shown under the outstanding-rent line ───────────────────────

// "daily" minus "ly" is "dai". Spelling the nouns out is the point of the
// helper — this is the assertion that would have caught it.
test("cycle counts read as English", () => {
  expect(cycleCountLabel("monthly", 6)).toBe("6 months");
  expect(cycleCountLabel("weekly", 5)).toBe("5 weeks");
  expect(cycleCountLabel("daily", 10)).toBe("10 days");
});

test("one of anything is singular", () => {
  expect(cycleCountLabel("monthly", 1)).toBe("1 month");
  expect(cycleCountLabel("weekly", 1)).toBe("1 week");
  expect(cycleCountLabel("daily", 1)).toBe("1 day");
});

// A cycle the frontend does not know about should degrade to something
// readable rather than "6 undefineds".
test("an unknown cycle falls back to its own name", () => {
  expect(cycleCountLabel("fortnightly", 3)).toBe("3 fortnightlys");
});

// ─── The move-out sheet's house rules ────────────────────────────────────────
//
//   ₹10,000 deposit held. Rent is never refunded; the deposit comes back only
//   to someone who gave notice; the owner has the last word.

import { moveOutSettlement, DEPOSIT_KEPT_LABEL, CHANGED_LABEL } from "../../src/lib/settlement";

test("notice given and square: the whole deposit goes back", () => {
  expect(moveOutSettlement(1000000, 0, { returnDeposit: true, deductions: [] }))
    .toEqual({ adjustments: [], proposed: 1000000, refund: 1000000 });
});

test("notice given, ₹2,500 rent owed: the deposit pays it and ₹7,500 goes back", () => {
  expect(moveOutSettlement(1000000, 250000, { returnDeposit: true, deductions: [] }).refund).toBe(750000);
});

test("rent paid for after they leave is kept, not added to the refund", () => {
  // dues −₹6,500: a month paid ahead. Still just the deposit back.
  expect(moveOutSettlement(1000000, -650000, { returnDeposit: true, deductions: [] }).refund).toBe(1000000);
});

test("no notice: what would have come back is kept, as its own line", () => {
  const r = moveOutSettlement(1000000, 250000, { returnDeposit: false, deductions: [] });
  expect(r.adjustments).toEqual([{ label: DEPOSIT_KEPT_LABEL, amount_paise: -750000 }]);
  expect(r.refund).toBe(0);
});

test("no notice and owing more than the deposit: they still owe the rest", () => {
  // ₹12,000 owed against a ₹10,000 deposit: nothing to keep, ₹2,000 owed.
  const r = moveOutSettlement(1000000, 1200000, { returnDeposit: false, deductions: [] });
  expect(r.adjustments).toEqual([]);
  expect(r.refund).toBe(-200000);
});

test("something taken off comes out of what goes back", () => {
  const r = moveOutSettlement(1000000, 0, {
    returnDeposit: true, deductions: [{ label: "Broken chair", amount_paise: -40000 }],
  });
  expect(r.refund).toBe(960000);
});

test("the owner's own amount wins, recorded as the difference", () => {
  // Proposed ₹0 (no notice), the owner hands back ₹4,000 anyway.
  const r = moveOutSettlement(1000000, 0, { returnDeposit: false, deductions: [], finalRefund: 400000 });
  expect(r.proposed).toBe(0);
  expect(r.refund).toBe(400000);
  expect(r.adjustments).toEqual([
    { label: DEPOSIT_KEPT_LABEL, amount_paise: -1000000 },
    { label: CHANGED_LABEL, amount_paise: 400000 },
  ]);
  // Typing the proposed figure back is no change at all.
  expect(moveOutSettlement(1000000, 0, { returnDeposit: true, deductions: [], finalRefund: 1000000 }).adjustments)
    .toEqual([]);
});
