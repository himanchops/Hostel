import { formatCurrency, type Adjustment } from "./api";

/**
 * "₹16,000 agreed · ₹0 received" — or null when the two are the same.
 *
 * The settlement refunds the deposit RECEIVED. The agreed figure is a rent
 * term typed at intake and used to be refunded as if it were money in the
 * drawer (the UX audit's first blocker). When they differ, the owner has to
 * see both, because the most likely explanation is a deposit that was paid and
 * never written down — which the owner can fix before settling, and nobody
 * else can.
 */
export function depositLine(agreedPaise: number, receivedPaise: number): string | null {
  if (agreedPaise === receivedPaise) return null;
  return `${formatCurrency(agreedPaise)} agreed · ${formatCurrency(receivedPaise)} received`;
}

/**
 * The deposit line on a tenant's stay card, where the audit found the deposit
 * "appears nowhere". `receivedPaise` is undefined while the ledger is loading,
 * so the card never claims ₹0 received before it knows.
 */
export function depositSummary(agreedPaise: number, receivedPaise: number | undefined): string | null {
  if (receivedPaise === undefined) {
    return agreedPaise > 0 ? `Deposit ${formatCurrency(agreedPaise)} agreed` : null;
  }
  if (agreedPaise === 0 && receivedPaise === 0) return null;
  const differs = depositLine(agreedPaise, receivedPaise);
  return differs ? `Deposit ${differs}` : `Deposit ${formatCurrency(receivedPaise)} received`;
}

/**
 * How much rent the tenant paid beyond what was billed. Zero when they owe.
 * Mirrors handlers.advanceHeld.
 */
export function advanceHeld(duesPaise: number): number {
  return duesPaise < 0 ? -duesPaise : 0;
}

/**
 * The settlement arithmetic, mirroring handlers.refundFor in the backend.
 *
 * It exists on both sides on purpose: the drawer recomputes on every keystroke
 * so the owner watches the refund move as they type, and the server recomputes
 * on submit and rejects a mismatch. This copy is the one that can be wrong
 * without anyone noticing, which is why it is a pure function with its own
 * tests rather than arithmetic inlined in a component.
 *
 * `advanceReturnedPaise` is a separate term rather than falling out of a signed
 * `duesPaise`. Subtracting a negative would hand a rent advance back
 * automatically, which quietly makes a policy decision that belongs to the
 * owner — all of it, some of it, or none.
 *
 * Negative refund = the tenant owes the owner.
 */
export function refundFor(
  depositPaise: number,
  duesPaise: number,
  advanceReturnedPaise: number,
  adjustments: Adjustment[]
): number {
  const base = depositPaise + advanceReturnedPaise - Math.max(duesPaise, 0);
  return adjustments.reduce((sum, a) => sum + a.amount_paise, base);
}

/**
 * Parses what an owner types into an amount box, in rupees, to paise.
 *
 * Returns null for anything that is not a plain non-negative amount — the
 * caller decides the sign from the Deduct/Add choice, so a typed minus is
 * rejected rather than silently doubling up with it.
 *
 * Commas are accepted because "1,200" is how the amount appears on every other
 * screen in the app. parseFloat alone reads that as 1, which would turn a
 * ₹1,200 deduction into ₹1 without complaining.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  // Round the product rather than trusting binary floating point: 12.35 * 100
  // is 1234.9999999999998, which truncates to ₹12.34.
  return Math.round(parseFloat(cleaned) * 100);
}

const CYCLE_NOUN: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

/**
 * "6 months", "1 week", "10 days" — the working shown under the outstanding
 * rent line.
 *
 * Stripping "ly" off the cycle name almost works and then says "10 dais", so
 * the nouns are spelled out. An unrecognised cycle falls back to the raw value
 * rather than rendering "undefined" at the owner.
 */
export function cycleCountLabel(cycle: string, count: number): string {
  const noun = CYCLE_NOUN[cycle] ?? cycle;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
