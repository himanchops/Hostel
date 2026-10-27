/**
 * Dates for changing rent, mirroring the backend's billing rules
 * (backend/internal/handlers/collections.go cycleStart, rent.go).
 *
 * Billing is anchored to the move-in day, not the calendar: someone who moved
 * in on the 6th is due on the 6th. A rent change applies to every cycle that
 * BEGINS on or after its date, so the natural default for "starting from" is
 * the next due date — the first cycle the tenant has not started yet.
 */

type Cycle = "daily" | "weekly" | "monthly";

const PER: Record<Cycle, string> = { monthly: "a month", weekly: "a week", daily: "a night" };

/**
 * "a month", "a week", "a night": how every screen says what a rent is for,
 * as in "₹500 a night". The grid's bed panel once printed "/mo" for every
 * stay, so a guest's nightly ₹500 read as a monthly rent, and the tenant page
 * printed "/monthly".
 */
export function perCycle(cycle: string): string {
  return PER[cycle as Cycle] ?? `per ${cycle}`;
}

function utc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The date cycle n (1 = the move-in day) begins. Month-end days clamp. */
export function cycleStart(start: string, n: number, cycle: Cycle): string {
  const s = utc(start);
  if (cycle === "daily") {
    s.setUTCDate(s.getUTCDate() + (n - 1));
    return iso(s);
  }
  if (cycle === "weekly") {
    s.setUTCDate(s.getUTCDate() + 7 * (n - 1));
    return iso(s);
  }
  const months = s.getUTCMonth() + (n - 1);
  const year = s.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, month, Math.min(s.getUTCDate(), last))));
}

/** The first due date strictly after `today` — when a new rent would first bite. */
export function nextDueDate(start: string, cycle: Cycle, today: string): string {
  for (let n = 1; n < 10000; n++) {
    const d = cycleStart(start, n, cycle);
    if (d > today.slice(0, 10)) return d;
  }
  return today.slice(0, 10);
}

/** The first due date on or after `date` — when a change dated `date` takes effect. */
export function firstDueOnOrAfter(start: string, cycle: Cycle, date: string): string {
  for (let n = 1; n < 10000; n++) {
    const d = cycleStart(start, n, cycle);
    if (d >= date.slice(0, 10)) return d;
  }
  return date.slice(0, 10);
}

/**
 * The start of the cycle `date` falls in: the latest due date on or before it.
 * A move's "this month" rent starts here (backend moveRentFrom).
 */
export function cycleContaining(start: string, cycle: Cycle, date: string): string {
  let current = start.slice(0, 10);
  for (let n = 2; n < 10000; n++) {
    const d = cycleStart(start, n, cycle);
    if (d > date.slice(0, 10)) return current;
    current = d;
  }
  return current;
}

/**
 * Nights a daily guest stays, from the day they arrive to the day they leave.
 * The leaving day is not a night: in on the 26th, out on the 31st is five,
 * the same count the backend bills (`cyclesThroughEnd`, every cycle that began
 * before the leaving day). 0 for anything else.
 */
export function stayNights(cycle: string, start: string, leaving: string): number {
  if (cycle !== "daily" || !start || !leaving) return 0;
  return Math.max(0, Math.round((utc(leaving).getTime() - utc(start).getTime()) / 86_400_000));
}

/**
 * The whole stay at a nightly rate, in rupees as a form holds them: "2500"
 * for ₹500 × 5. Guests are priced per night (owner, 26 Oct 2026), never as
 * one amount for the stay. "" when the rate isn't a number yet.
 */
export function rentForNights(nightly: string, nights: number): string {
  const rate = parseFloat(nightly);
  if (Number.isNaN(rate) || nights <= 0) return "";
  return String(Math.round(rate * 100 * nights) / 100);
}
