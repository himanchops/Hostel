import { formatCurrency, formatDay } from "./api";

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri, 24 Oct" — a date in the coming week reads best with its weekday. */
export function dueWeekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dueDay(date)}`;
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

/**
 * How close is close enough to act on: a date on a grid tile, and a row in
 * the Payments screen's "Due this week".
 */
export const DUE_SOON_DAYS = 7;

/** Due today, or paid up now with the next rent due within the week. */
export function dueSoon(due: Due, today: string): boolean {
  if (due.due_state === "due_today") return true;
  return due.due_state === "upcoming" && !!due.due_date && daysUntil(due.due_date, today) <= DUE_SOON_DAYS;
}

/**
 * The few words a grid tile has room for, or null. A tile shows a date only
 * when it is worth acting on: overdue (the tile is already red; this says
 * since when), due today, or due within a week.
 */
export function dueChip(due: Due, today: string): { text: string; tone: "danger" | "warning" } | null {
  if (!due.due_date || !due.due_state) return null;
  if (due.due_state === "overdue") return { text: `due ${dueDay(due.due_date)}`, tone: "danger" };
  if (due.due_state === "due_today") return { text: "due today", tone: "warning" };
  if (dueSoon(due, today)) return { text: `due ${dueDay(due.due_date)}`, tone: "warning" };
  return null;
}

/**
 * A notice carries two dates that mean different things: when the tenant told
 * you, and when they say they are going. The dashboard once printed both bare
 * under one heading — "Notice: 2026-08-31" on one row, "Leaving 2026-09-30" on
 * the next — and three testers read the first as "he left nine days ago"; one
 * would have re-let the bed (UX audit). Each date now carries its own verb,
 * and a missing leaving date is said rather than left out. The dashboard's
 * Vacating Soon and the grid's bed panel say it the same way.
 */
export function departureFacts(
  stay: { notice_date?: string; expected_end_date?: string },
  today: string,
): string[] {
  const facts: string[] = [];
  if (stay.notice_date) facts.push(`gave notice ${formatDay(stay.notice_date)}`);
  const date = stay.expected_end_date?.slice(0, 10);
  if (!date) {
    facts.push("no leaving date yet");
  } else {
    const days = daysUntil(date, today);
    const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
    if (days < 0) facts.push(`was due to leave ${formatDay(date)}, ${plural(-days)} ago`);
    else if (days === 0) facts.push("leaving today");
    else facts.push(`leaving ${formatDay(date)}, in ${plural(days)}`);
  }
  return facts.map((f, i) => (i === 0 ? f[0].toUpperCase() + f.slice(1) : f));
}

export interface Leaving {
  status: string;
  notice_date?: string;
  expected_end_date?: string;
}

/**
 * When a vacating tenant goes, in the few words a grid tile has room for, or
 * null for anyone else. On their tile it takes the rent date's place: what is
 * owed still shows as an amount, and the date that matters is the leaving one.
 *
 * A passed date is a question, because nothing ends a stay on its own: the
 * owner confirms they went.
 */
export function leavingChip(bed: Leaving, today: string): string | null {
  const date = bed.expected_end_date?.slice(0, 10);
  if (bed.status === "departure_due" && date) return `left ${dueDay(date)}?`;
  if (bed.status !== "vacating_soon") return null;
  if (!date) return "notice given";
  // "leaves tomorrow" does not fit a tile; tomorrow's date does.
  if (daysUntil(date, today) === 0) return "leaves today";
  return `leaves ${dueDay(date)}`;
}

/** Today in the owner's own timezone, as "YYYY-MM-DD". */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Yesterday in the owner's own timezone, as "YYYY-MM-DD". */
export function localYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
