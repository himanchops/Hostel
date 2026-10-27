import { formatCurrency, formatDay, type Payment } from "./api";
import { payMethodLabel } from "./payMethod";

/**
 * "Changed 27 Oct 2026 · was ₹8,000, 1 Oct 2026" — what a corrected payment
 * said before its latest change, naming only what moved (migration 016).
 * Null for a payment never changed.
 */
export function changedLine(p: Payment): string | null {
  const was = p.last_edit;
  if (!was) return null;
  const parts: string[] = [];
  if (was.amount !== p.amount) parts.push(formatCurrency(was.amount));
  if (was.kind !== p.kind) parts.push(was.kind === "deposit" ? "deposit" : "rent");
  if (was.payment_type !== p.payment_type) parts.push(payMethodLabel(was.payment_type));
  if (was.payment_date.slice(0, 10) !== p.payment_date.slice(0, 10)) parts.push(formatDay(was.payment_date));
  if ((was.notes ?? "") !== (p.notes ?? "")) parts.push(was.notes ? `“${was.notes}”` : "no note");
  const when = `Changed ${formatDay(was.edited_at)}`;
  return parts.length ? `${when} · was ${parts.join(", ")}` : when;
}

/** "Changed 27 Oct 2026", for the ledger row; the sheet shows the whole line. */
export function changedTag(p: Payment): string | null {
  return p.last_edit ? `Changed ${formatDay(p.last_edit.edited_at)}` : null;
}
