import { formatCurrency } from "./api";

/**
 * When rent is next due, as the backend works it out (handlers/due.go). The
 * client only words it; it never recomputes a date.
 *
 *   overdue     date is the day they fell behind
 *   due_today   a cycle began today and is unpaid
 *   upcoming    paid up to now; date is the next due day
 *   paid_ahead  paid past this cycle; date is when the next payment falls due
 */
export type DueState = "overdue" | "due_today" | "upcoming" | "paid_ahead";

export interface Due {
  due_date?: string; // "2026-10-31"
  due_paise?: number;
  due_state?: DueState;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "31 Oct" from "2026-10-31", without a Date, so no timezone can move it. */
export function dueDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Whole days from `today` to `date`, both "YYYY-MM-DD". */
export function daysUntil(date: string, today: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

/** One line for the bed panel and the tenant page, or null when nothing is open. */
export function dueLine(due: Due): { text: string; tone: "danger" | "warning" | "neutral" } | null {
  if (!due.due_date || !due.due_state) return null;
  const day = dueDay(due.due_date);
  const amount = formatCurrency(due.due_paise ?? 0);
  switch (due.due_state) {
    case "overdue":
      return { text: `Overdue since ${day}`, tone: "danger" };
    case "due_today":
      return { text: `Rent ${amount} due today`, tone: "warning" };
    case "paid_ahead":
      return { text: `Paid up to ${day}`, tone: "neutral" };
    default:
      return { text: `Next rent ${amount} due ${day}`, tone: "neutral" };
  }
}

/** How close is close enough to put a date on a grid tile. */
export const TILE_DUE_DAYS = 7;

/**
 * The few words a grid tile has room for, or null. A tile shows a date only
 * when it is worth acting on: overdue (the tile is already red; this says
 * since when), due today, or due within a week.
 */
export function dueChip(due: Due, today: string): { text: string; tone: "danger" | "warning" } | null {
  if (!due.due_date || !due.due_state) return null;
  if (due.due_state === "overdue") return { text: `due ${dueDay(due.due_date)}`, tone: "danger" };
  if (due.due_state === "due_today") return { text: "due today", tone: "warning" };
  if (due.due_state === "upcoming" && daysUntil(due.due_date, today) <= TILE_DUE_DAYS) {
    return { text: `due ${dueDay(due.due_date)}`, tone: "warning" };
  }
  return null;
}

/** Today in the owner's own timezone, as "YYYY-MM-DD". */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
