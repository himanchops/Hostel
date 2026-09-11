import { test, expect } from "@playwright/test";
import { depositLine, depositSummary, refundFor } from "../../src/lib/settlement";

// The UX audit's first blocker: the settlement refunded the deposit AGREED at
// intake as if it were money received. The fixture is the backend's —
// backend/internal/handlers/settlements_test.go, "The deposit refunded is the
// deposit received" — ₹8,500/month, ₹17,000 deposit agreed.

test("agreed and received are both shown, only when they differ", () => {
  expect(depositLine(1600000, 0)).toBe("₹16,000 agreed · ₹0 received");
  expect(depositLine(1700000, 1000000)).toBe("₹17,000 agreed · ₹10,000 received");
  expect(depositLine(2000000, 1700000)).toBe("₹20,000 agreed · ₹17,000 received");
  expect(depositLine(1700000, 1700000)).toBeNull();
  expect(depositLine(0, 0)).toBeNull();
});

// The drawer recomputes the refund on every keystroke from deposit_paise, which
// is now the deposit held. These are the backend's three cases, to the paisa.
test("the refund is built on the deposit received", () => {
  // Nothing paid, one cycle billed. The old arithmetic, refundFor(1700000, …),
  // gave +₹8,500 here.
  expect(refundFor(0, 850000, 0, [])).toBe(-850000);

  // ₹6,000 + ₹4,000 of the ₹17,000 paid; ₹8,500 of rent outstanding.
  expect(refundFor(600000 + 400000, 850000, 0, [])).toBe(150000);

  // A deposit written down as rent reads as a ₹17,000 advance and comes back
  // once — the old code added the agreed ₹17,000 on top and gave ₹34,000.
  expect(refundFor(0, -1700000, 1700000, [])).toBe(1700000);
});

test("the stay card never claims ₹0 received before the ledger has loaded", () => {
  expect(depositSummary(1700000, undefined)).toBe("Deposit ₹17,000 agreed");
  expect(depositSummary(0, undefined)).toBeNull();

  expect(depositSummary(1700000, 0)).toBe("Deposit ₹17,000 agreed · ₹0 received");
  expect(depositSummary(1700000, 1700000)).toBe("Deposit ₹17,000 received");
  // Paid with nothing agreed is still money held, so it is still shown.
  expect(depositSummary(0, 500000)).toBe("Deposit ₹0 agreed · ₹5,000 received");
  expect(depositSummary(0, 0)).toBeNull();
});
