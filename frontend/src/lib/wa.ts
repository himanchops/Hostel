import { formatCurrency } from "./api";
import type { CollectionRow } from "./api";

/**
 * WhatsApp deep links. There is no WhatsApp API involved anywhere here: a
 * wa.me link opens the owner's own WhatsApp with the chat open and the message
 * typed into the box, and the owner presses send. The app never sends anything
 * by itself, which is the whole point — no Business API approval, no per-message
 * billing, and no way for this software to message a tenant unprompted.
 */

/**
 * Reduces a phone number as typed by a human to the digits wa.me expects.
 *
 * Numbers get entered as "9812345601", "+91 98123 45601", "098123-45601" and
 * worse. Exactly two shapes are accepted: ten digits, which are assumed Indian
 * and get a 91 prefix, and twelve digits that already start with 91.
 *
 * The plan said "twelve digits" and stopped there, but a bare length check lets
 * a mis-typed leading zero through — "098123456012" is twelve digits and is not
 * anybody's number. The failure mode of guessing is opening a stranger's chat
 * with a tenant's rent in it, so ambiguous input is rejected and the caller
 * offers to fix the number instead. The cost is that a genuine non-Indian
 * number can't be nudged; the app is rupee-denominated and India-only today,
 * and the 10-digit branch already assumes as much.
 */
export function normalizePhone(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

/**
 * Builds the wa.me link, or null when the number cannot be trusted — callers
 * hide the nudge button in that case and offer to fix the number instead.
 */
export function waLink(phone: string, message: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** "due today" / "due 1 day ago" / "due 12 days ago" */
export function duePhrase(daysSinceDue: number): string {
  if (daysSinceDue <= 0) return "due today";
  if (daysSinceDue === 1) return "due 1 day ago";
  return `due ${daysSinceDue} days ago`;
}

/** Room 101 · Bed A, or just the room when no bed is assigned yet. */
export function roomLabel(row: Pick<CollectionRow, "room_name" | "bed_name">): string {
  if (!row.room_name) return row.bed_name ?? "";
  return row.bed_name ? `${row.room_name} · ${row.bed_name}` : row.room_name;
}

/**
 * The default nudge. Deliberately plain and non-threatening: the owner is
 * messaging someone who lives in their building and will read it on a phone.
 */
export function nudgeMessage(
  row: Pick<
    CollectionRow,
    "tenant_name" | "room_name" | "bed_name" | "balance_paise" | "days_since_due"
  >
): string {
  const firstName = row.tenant_name.trim().split(/\s+/)[0] || row.tenant_name;
  const where = roomLabel(row);
  const place = where ? ` for ${where}` : "";
  return (
    `Hi ${firstName}, this is a reminder that rent of ` +
    `${formatCurrency(row.balance_paise)}${place} is pending ` +
    `(${duePhrase(row.days_since_due)}). ` +
    `Please pay at your convenience. Thank you!`
  );
}
