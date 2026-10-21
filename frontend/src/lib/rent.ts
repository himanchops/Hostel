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
