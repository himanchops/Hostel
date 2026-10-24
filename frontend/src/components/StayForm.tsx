"use client";

import { useEffect, useState } from "react";
import {
  gridApi, sitesApi, staysApi,
  GridRoom, Site,
  today, formatDay, formatCurrency, ApiError,
} from "@/lib/api";
import { Button, Field, FormError, Input, SegmentedControl, Select } from "@/components/ui";
import { PAY_METHODS, PayMethod } from "@/lib/payMethod";

/**
 * The two halves of "put this person in that bed", shared by every screen that
 * asks it.
 *
 * There were four copies before this file: the grid's assign drawer, the
 * pending-registration approval drawer, the tenant page's "Assign bed" modal,
 * and — the one that started this — nothing at all on the new-tenant form,
 * which is why adding a tenant meant creating a person and then hunting through
 * Sites → room → bed to give them somewhere to sleep.
 *
 * The copies had already drifted: only the pending drawer's rent label followed
 * the billing cycle, so the grid asked for "Monthly rent" while collecting a
 * daily one. That is the same drift the shared move-out dialog was created to end, and the
 * reason a fourth caller had to be an extraction rather than a fifth copy.
 */

// ─── Rent terms ───────────────────────────────────────────────────────────────

/**
 * Terms as typed, not as stored: rent and deposit are rupee strings straight
 * from the input, so a half-typed "80" is representable. `stayTermsPayload`
 * is the single place they become paise.
 */
export interface StayTerms {
  cycle: string;
  /** Rupees, as typed. */
  rent: string;
  /** Rupees, as typed. */
  deposit: string;
  startDate: string;
}

export function emptyStayTerms(): StayTerms {
  return { cycle: "monthly", rent: "", deposit: "", startDate: today() };
}

/** Rupees → paise, in one place, because getting this wrong is a money bug. */
export function stayTermsPayload(terms: StayTerms) {
  return {
    rent_amount: Math.round(parseFloat(terms.rent || "0") * 100),
    deposit_amount: Math.round(parseFloat(terms.deposit || "0") * 100),
    rent_cycle: terms.cycle,
    start_date: terms.startDate,
  };
}

/** What's missing, phrased for a form error — or "" when the terms are usable. */
export function stayTermsError(terms: StayTerms): string {
  if (!terms.rent.trim()) return "Enter the rent amount.";
  if (Number.isNaN(parseFloat(terms.rent))) return "Rent must be a number.";
  if (!terms.startDate) return "Pick a start date.";
  return "";
}

type Cycle = "monthly" | "weekly" | "daily";
const CYCLES: readonly { value: Cycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
];

function rentLabel(cycle: string): string {
  if (cycle === "weekly") return "Weekly rent (₹)";
  if (cycle === "daily") return "Daily rent (₹)";
  return "Monthly rent (₹)";
}

export function StayTermsFields({
  value,
  onChange,
  layout = "stack",
  startLabel = "Start date",
}: {
  value: StayTerms;
  onChange: (next: StayTerms) => void;
  /** "grid" pairs the fields two-up; "stack" suits a narrow drawer. */
  layout?: "stack" | "grid";
  /** "Arriving on" for a booking. */
  startLabel?: string;
}) {
  const set = (patch: Partial<StayTerms>) => onChange({ ...value, ...patch });
  const wrap =
    layout === "grid"
      ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
      : "space-y-3";

  return (
    <div className={wrap}>
      {/* Cycle comes first because it renames the rent field. It is three
          buttons rather than a dropdown: nearly always Monthly, and one tap
          when it isn't. In the grid layout it shares a row with the date. */}
      <div>
        <p className="mb-1 text-[13px] font-medium text-stone-600">Billing cycle</p>
        <SegmentedControl
          options={CYCLES}
          value={value.cycle as Cycle}
          onChange={(cycle) => set({ cycle })}
          ariaLabel="Billing cycle"
        />
      </div>
      <Field label={startLabel} required>
        <Input
          type="date"
          value={value.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </Field>
      <Field label={rentLabel(value.cycle)} required>
        <Input
          type="number"
          min="0"
          placeholder="e.g. 5000"
          value={value.rent}
          onChange={(e) => set({ rent: e.target.value })}
        />
      </Field>
      <Field label="Deposit (₹)">
        <Input
          type="number"
          min="0"
          placeholder="e.g. 10000"
          value={value.deposit}
          onChange={(e) => set({ deposit: e.target.value })}
        />
      </Field>
    </div>
  );
}

// ─── Paid today ───────────────────────────────────────────────────────────────

/**
 * What they handed over. Nearly everyone pays the first rent, and usually the
 * deposit, the day they move in; someone booking a place pays something to
 * hold it and the rest on arrival. Before this the forms took only the terms,
 * and the money was a second visit to the tenant page that was easy to forget.
 *
 * Each amount starts at a suggestion — one rent period and the agreed deposit
 * on a move-in, nothing on a booking, what's still owed on arrival — and
 * follows it until the owner types over it. Each becomes an ordinary payment,
 * recorded through the same endpoint as any other.
 */
export interface PaidToday {
  /** Rupees as typed, or null to follow the suggestion. */
  rent: string | null;
  /** Rupees as typed, or null to follow the suggestion. */
  deposit: string | null;
  method: PayMethod;
  /** "They haven't paid yet": nothing is recorded. */
  none: boolean;
}

/** What the two boxes start at, in rupees as a form holds them. */
export interface PaidSuggestion {
  rent: string;
  deposit: string;
}

export function emptyPaidToday(): PaidToday {
  return { rent: null, deposit: null, method: "cash", none: false };
}

/** A move-in: one rent period and the deposit agreed. */
export function suggestedFromTerms(terms: StayTerms): PaidSuggestion {
  return { rent: terms.rent, deposit: terms.deposit };
}

/** A booking: whatever they paid to hold the place, so nothing assumed. */
export const NOTHING_SUGGESTED: PaidSuggestion = { rent: "", deposit: "" };

function rupeesToPaise(rupees: string): number {
  const n = parseFloat(rupees || "0");
  return Number.isNaN(n) ? NaN : Math.round(n * 100);
}

/** The two amounts in paise, 0 for anything not paid. */
export function paidTodayAmounts(paid: PaidToday, suggested: PaidSuggestion) {
  if (paid.none) return { rent: 0, deposit: 0 };
  return {
    rent: rupeesToPaise(paid.rent ?? suggested.rent),
    deposit: rupeesToPaise(paid.deposit ?? suggested.deposit),
  };
}

/** What's wrong with the amounts, phrased for a form error, or "". */
export function paidTodayError(paid: PaidToday, suggested: PaidSuggestion): string {
  const { rent, deposit } = paidTodayAmounts(paid, suggested);
  if (Number.isNaN(rent) || rent < 0) return "Rent paid must be a number.";
  if (Number.isNaN(deposit) || deposit < 0) return "Deposit paid must be a number.";
  return "";
}

/**
 * The day a move-in's payments are dated: the start day, which is when people
 * pay. Never later than today, because a payment can't be dated in the future,
 * and money taken now for a stay that starts next week was taken now.
 */
export function paidTodayDate(terms: StayTerms): string {
  const now = today();
  return terms.startDate && terms.startDate < now ? terms.startDate : now;
}

/** " · ₹16,000 paid" for a button or toast, or "" when nothing was paid. */
export function paidTodaySuffix(paid: PaidToday, suggested: PaidSuggestion): string {
  const { rent, deposit } = paidTodayAmounts(paid, suggested);
  const total = (rent > 0 ? rent : 0) + (deposit > 0 ? deposit : 0);
  return total > 0 ? ` \u00b7 ${formatCurrency(total)} paid` : "";
}

/**
 * Records the payments on a stay that now exists. Returns "" when everything
 * was recorded, or a sentence naming what was not. The stay is already made
 * by then, so a failure here is reported rather than thrown: the caller says
 * so in a toast and the owner records it from Payments.
 */
export async function recordPaidToday(
  token: string, stayId: number, paid: PaidToday, suggested: PaidSuggestion, date: string,
): Promise<string> {
  const { rent, deposit } = paidTodayAmounts(paid, suggested);
  const base = { payment_type: paid.method, payment_date: date };
  const missed: string[] = [];
  for (const [kind, amount] of [["rent", rent], ["deposit", deposit]] as const) {
    if (!(amount > 0)) continue;
    try {
      await staysApi.addPayment(token, stayId, { ...base, amount, kind });
    } catch {
      missed.push(`${kind} of ${formatCurrency(amount)}`);
    }
  }
  return missed.length ? `The ${missed.join(" and the ")} wasn't recorded. Record it from Payments.` : "";
}

function firstPeriodLabel(cycle: string): string {
  if (cycle === "weekly") return "Rent \u00b7 first week (₹)";
  if (cycle === "daily") return "Rent \u00b7 first night (₹)";
  return "Rent \u00b7 first month (₹)";
}

export function PaidTodayFields({
  value,
  onChange,
  suggested,
  date,
  cycle,
  heading,
  rentLabel,
  hint,
}: {
  value: PaidToday;
  onChange: (next: PaidToday) => void;
  suggested: PaidSuggestion;
  /** The day the payments will be dated, YYYY-MM-DD. */
  date: string;
  cycle: string;
  /** Defaults to "Paid today", or "Paid on 18 Oct 2026" for another day. */
  heading?: string;
  /** Defaults to the first rent period: "Rent · first month (₹)". */
  rentLabel?: string;
  hint?: string;
}) {
  const set = (patch: Partial<PaidToday>) => onChange({ ...value, ...patch });
  const title = heading ?? (date === today() ? "Paid today" : `Paid on ${formatDay(date)}`);

  return (
    <section aria-label={title} className="@container rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => set({ none: !value.none })}
        >
          {value.none ? "They paid something" : "They haven\u2019t paid yet"}
        </Button>
      </div>

      {value.none ? (
        <p className="mt-1 text-[13px] text-stone-500">
          Nothing is recorded. What they owe shows on Payments.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {hint && <p className="-mt-1 text-[13px] text-stone-500">{hint}</p>}
          {/* Sized by the section, not the screen: three across on a page,
              two in a drawer, one on a phone. */}
          <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @xl:grid-cols-3">
            <Field label={rentLabel ?? firstPeriodLabel(cycle)}>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={value.rent ?? suggested.rent}
                onChange={(e) => set({ rent: e.target.value })}
              />
            </Field>
            <Field label="Deposit paid (₹)">
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={value.deposit ?? suggested.deposit}
                onChange={(e) => set({ deposit: e.target.value })}
              />
            </Field>
            <div>
              <p className="mb-1 text-[13px] font-medium text-stone-600">Paid by</p>
              <SegmentedControl
                options={PAY_METHODS}
                value={value.method}
                onChange={(method) => set({ method })}
                ariaLabel="Paid by"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The same section for someone booking a place: nothing assumed, dated today,
 * and said in those words.
 */
export function PaidToBookFields({
  value, onChange, cycle,
}: {
  value: PaidToday;
  onChange: (next: PaidToday) => void;
  cycle: string;
}) {
  return (
    <PaidTodayFields
      value={value}
      onChange={onChange}
      suggested={NOTHING_SUGGESTED}
      date={today()}
      cycle={cycle}
      heading="Paid to book"
      rentLabel="Rent paid ahead (₹)"
      hint="Whatever they paid to hold the place. The rest is due the day they arrive."
    />
  );
}

// ─── Bed picker ───────────────────────────────────────────────────────────────

/**
 * What is happening at the desk, which decides what the rest of a form asks.
 * Add tenant and the pending queue's approval ask it the same way.
 *
 *  - now:     they're moving in. A bed, the terms, and what they paid.
 *  - booking: they're holding a place for a later day. The terms, the day
 *             they arrive, and what they paid to hold it. No bed: the owner
 *             promises a place, not a particular bed, and assigns one when
 *             they arrive (tenant page → Assign bed).
 *  - later:   just the person, for now.
 */
export type Arrival = "now" | "booking" | "later";

/** The three answers; only the last one's wording differs between screens. */
export function arrivalOptions(laterLabel: string): readonly { value: Arrival; label: string }[] {
  return [
    { value: "now", label: "Moving in" },
    { value: "booking", label: "Booking" },
    { value: "later", label: laterLabel },
  ];
}

export const ARRIVAL_HINT: Record<Arrival, string> = {
  now: "They're moving in. Pick a bed and record what they paid.",
  booking: "They're holding a place for a later day. Assign a bed when they arrive.",
  later: "Only their details for now. Give them a bed later from the grid.",
};

export interface VacantBed {
  id: number;
  name: string;
  roomName: string;
  siteId: number;
}

/**
 * Site chooser plus the vacant beds in it.
 *
 * Vacancy comes from the grid rather than a beds list because the grid is what
 * already knows the difference — `status === "vacant"` means no active stay,
 * and there is no other endpoint that answers that question. The cost is one
 * grid fetch per site change, which is the same cost the three earlier copies
 * paid.
 */
export function BedPicker({
  token,
  value,
  onChange,
}: {
  token: string;
  value: VacantBed | null;
  onChange: (bed: VacantBed | null) => void;
}) {
  // Null until the list arrives. An empty list is a real answer — "add a site
  // first" — and it used to be the answer shown while the request was still in
  // flight: three seconds of confident, wrong instruction to an owner with two
  // sites (UX audit M11).
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<GridRoom[] | null>(null);
  // A failed load is said as one. Both requests used to fail silently into an
  // empty answer, so a dropped connection read as "no sites" or "site full".
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    sitesApi
      .list(token)
      .then((s) => {
        if (cancelled) return;
        setSites(s);
        if (s.length > 0) setSiteId((prev) => prev ?? s[0].id);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Could not load your sites");
      });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    // Null means "still loading" — distinct from an empty list, which means
    // "this site is full" and deserves saying out loud.
    setRooms(null);
    setLoadError("");
    onChange(null);
    gridApi
      .get(token, siteId)
      .then((g) => { if (!cancelled) setRooms(g); })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Could not load this site's beds");
      });
    return () => { cancelled = true; };
    // onChange is a caller's inline closure on every render; depending on it
    // would refetch the grid forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, siteId]);

  const vacant: VacantBed[] = (rooms ?? []).flatMap((room) =>
    room.beds
      .filter((b) => b.status === "vacant")
      .map((b) => ({ id: b.id, name: b.name, roomName: room.name, siteId: siteId! }))
  );

  // A dropdown, not a list of radio buttons: the list grew with every vacant
  // bed and was the tallest thing on Add tenant (Oct 2026).
  const status = loadError ? null
    : sites === null ? "Loading your sites\u2026"
    : sites.length === 0 ? "No sites yet. Add a site with rooms and beds first."
    : rooms === null ? "Loading beds\u2026"
    : vacant.length === 0 ? "No vacant beds in this site."
    : null;

  return (
    <div className={sites && sites.length > 1 ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : undefined}>
      {sites && sites.length > 1 && (
        <Field label="Site">
          <Select
            value={siteId ?? ""}
            onChange={(e) => setSiteId(Number(e.target.value))}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      )}

      {loadError ? (
        <FormError>{loadError} — reload the page to try again.</FormError>
      ) : status ? (
        <div>
          <p className="mb-1 text-[13px] font-medium text-stone-600">Bed</p>
          <p className="text-sm text-stone-400">{status}</p>
        </div>
      ) : (
        <Field label="Bed">
          <Select
            value={value?.id ?? ""}
            onChange={(e) => onChange(vacant.find((b) => b.id === Number(e.target.value)) ?? null)}
          >
            <option value="">Pick a vacant bed…</option>
            {vacant.map((b) => (
              <option key={b.id} value={b.id}>{b.roomName} · {b.name}</option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
