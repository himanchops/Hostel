import { test, expect } from "@playwright/test";
import { formatCurrency } from "../../src/lib/api";

// Money is stored in paise everywhere in the app (₹1 = 100 paise) and only
// becomes rupees at the moment it is displayed. These assert the exact rendered
// string, glyph for glyph — the ₹ is U+20B9 and there is no space after it.

test("paise convert to rupees", () => {
  expect(formatCurrency(0)).toBe("₹0");
  expect(formatCurrency(100)).toBe("₹1");
  expect(formatCurrency(750000)).toBe("₹7,500");
  expect(formatCurrency(1250000)).toBe("₹12,500");
});

// en-IN groups in lakhs and crores: the first group is three digits, every
// group after it is two. A plain en-US formatter would render ₹100,000 here.
test("groups digits the Indian way", () => {
  expect(formatCurrency(10000000)).toBe("₹1,00,000"); // one lakh
  expect(formatCurrency(123456789)).toBe("₹12,34,568"); // rounded, see below
  expect(formatCurrency(1000000000)).toBe("₹1,00,00,000"); // one crore
});

// Balances can go either way, and the two backend conventions have opposite
// signs: the tenant summary reports expected − paid (negative = the tenant is
// in credit), the grid reports paid − expected (negative = the tenant owes).
// formatCurrency renders whichever it is given — the sign goes outside the
// symbol and must never be dropped.
test("negative amounts keep their sign", () => {
  expect(formatCurrency(-750000)).toBe("-₹7,500");
  expect(formatCurrency(-100)).toBe("-₹1");
  expect(formatCurrency(-10000000)).toBe("-₹1,00,000");
});

// A settled balance is plain "₹0". JavaScript's negative zero does render as
// "-₹0", which is pinned here rather than fixed: the API only ever sends whole
// paise as integers, and Go marshals a zero int64 as "0", so -0 cannot reach
// this function from a real response. If a client-side computation ever starts
// producing it (multiplying a zero balance by a negative, say), this test is
// the tripwire.
test("zero is unsigned; negative zero is not", () => {
  expect(formatCurrency(0)).toBe("₹0");
  expect(formatCurrency(-0)).toBe("-₹0");
});

// Rupees are shown whole. Sub-rupee paise round half-up, so a stray paise in a
// balance rounds to the nearest rupee rather than showing decimals.
test("sub-rupee paise round to whole rupees", () => {
  expect(formatCurrency(750049)).toBe("₹7,500"); // ₹7,500.49
  expect(formatCurrency(750050)).toBe("₹7,501"); // ₹7,500.50 rounds up
  expect(formatCurrency(750099)).toBe("₹7,501");
  // One paise either way rounds to zero, but keeps its sign — "-₹0" is what a
  // one-paise imbalance actually renders as.
  expect(formatCurrency(-1)).toBe("-₹0");
  expect(formatCurrency(1)).toBe("₹0");
});

// The amounts this app actually handles: rent, deposits and running balances,
// on a stay six cycles in with five of them paid.
test("realistic ledger amounts", () => {
  const rent = 750000; // ₹7,500/month
  const deposit = 1500000; // two months
  const paid = 5 * rent;
  const expected = 6 * rent;

  expect(formatCurrency(rent)).toBe("₹7,500");
  expect(formatCurrency(deposit)).toBe("₹15,000");
  expect(formatCurrency(paid)).toBe("₹37,500");
  // Grid convention (paid − expected): a cycle behind reads as negative.
  expect(formatCurrency(paid - expected)).toBe("-₹7,500");
  // Summary convention (expected − paid): the same gap, positive.
  expect(formatCurrency(expected - paid)).toBe("₹7,500");
  // And a tenant two cycles ahead, on the summary convention — a credit.
  expect(formatCurrency(expected - 8 * rent)).toBe("-₹15,000");
});
