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

function rentLabel(cycle: string): string {
  if (cycle === "weekly") return "Weekly rent (₹)";
  if (cycle === "daily") return "Daily rent (₹)";
  return "Monthly rent (₹)";
}

export function StayTermsFields({
  value,
  onChange,
  layout = "stack",
}: {
  value: StayTerms;
  onChange: (next: StayTerms) => void;
  /** "grid" pairs the fields two-up; "stack" suits a narrow drawer. */
  layout?: "stack" | "grid";
}) {
  const set = (patch: Partial<StayTerms>) => onChange({ ...value, ...patch });
  const wrap =
    layout === "grid"
      ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
      : "space-y-3";

  return (
    <div className={wrap}>
      {/* Cycle comes first because it renames the field below it. */}
      <Field label="Billing cycle">
        <Select value={value.cycle} onChange={(e) => set({ cycle: e.target.value })}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
        </Select>
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
      <Field
        label="Start date"
        required
        className={layout === "grid" ? "sm:col-span-2" : undefined}
      >
        <Input
          type="date"
          value={value.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </Field>
    </div>
  );
}

// ─── Paid today ───────────────────────────────────────────────────────────────

/**
 * What they handed over on arrival. Nearly everyone pays the first rent, and
 * usually the deposit, the day they move in. Before this the form took only
 * the terms. The money was a second visit to the tenant page that was easy to
 * forget, and until then the new tenant showed as owing from their first day.
 *
 * Rent and deposit follow the terms (one rent period, the agreed deposit)
 * until the owner types over them, so changing the rent above changes what
 * was paid below. Each becomes an ordinary payment, recorded through the same
 * endpoint as any other.
 */
export interface PaidToday {
  /** Rupees as typed, or null to follow the terms. */
  rent: string | null;
  /** Rupees as typed, or null to follow the terms. */
  deposit: string | null;
  method: PayMethod;
  /** "They haven't paid yet": nothing is recorded. */
  none: boolean;
}

export function emptyPaidToday(): PaidToday {
  return { rent: null, deposit: null, method: "cash", none: false };
}

function rupeesToPaise(rupees: string): number {
  const n = parseFloat(rupees || "0");
  return Number.isNaN(n) ? NaN : Math.round(n * 100);
}

/** The two amounts in paise, 0 for anything not paid. */
export function paidTodayAmounts(paid: PaidToday, terms: StayTerms) {
  if (paid.none) return { rent: 0, deposit: 0 };
  return {
    rent: rupeesToPaise(paid.rent ?? terms.rent),
    deposit: rupeesToPaise(paid.deposit ?? terms.deposit),
  };
}

/** What's wrong with the amounts, phrased for a form error, or "". */
export function paidTodayError(paid: PaidToday, terms: StayTerms): string {
  const { rent, deposit } = paidTodayAmounts(paid, terms);
  if (Number.isNaN(rent) || rent < 0) return "Rent paid must be a number.";
  if (Number.isNaN(deposit) || deposit < 0) return "Deposit paid must be a number.";
  return "";
}

/**
 * The day the payments are dated: the start day, which is when people pay.
 * Never later than today, because a payment can't be dated in the future and
 * money taken now for a stay that starts next week was still taken now.
 */
export function paidTodayDate(terms: StayTerms): string {
  const now = today();
  return terms.startDate && terms.startDate < now ? terms.startDate : now;
}

/** " · ₹16,000 paid" for a button or toast, or "" when nothing was paid. */
export function paidTodaySuffix(paid: PaidToday, terms: StayTerms): string {
  const { rent, deposit } = paidTodayAmounts(paid, terms);
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
  token: string, stayId: number, paid: PaidToday, terms: StayTerms,
): Promise<string> {
  const { rent, deposit } = paidTodayAmounts(paid, terms);
  const base = { payment_type: paid.method, payment_date: paidTodayDate(terms) };
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

function paidRentLabel(cycle: string): string {
  if (cycle === "weekly") return "Rent · first week (₹)";
  if (cycle === "daily") return "Rent · first night (₹)";
  return "Rent · first month (₹)";
}

export function PaidTodayFields({
  value,
  onChange,
  terms,
}: {
  value: PaidToday;
  onChange: (next: PaidToday) => void;
  terms: StayTerms;
}) {
  const set = (patch: Partial<PaidToday>) => onChange({ ...value, ...patch });
  const date = paidTodayDate(terms);
  const heading = date === today() ? "Paid today" : `Paid on ${formatDay(date)}`;

  return (
    <section aria-label={heading} className="rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-800">{heading}</h3>
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
          Nothing is recorded. Their first rent shows as due on Payments.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={paidRentLabel(terms.cycle)}>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={value.rent ?? terms.rent}
                onChange={(e) => set({ rent: e.target.value })}
              />
            </Field>
            <Field label="Deposit paid (₹)">
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={value.deposit ?? terms.deposit}
                onChange={(e) => set({ deposit: e.target.value })}
              />
            </Field>
          </div>
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
      )}
    </section>
  );
}

// ─── Bed picker ───────────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-3">
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

      <div>
        <p className="mb-1 text-[13px] font-medium text-stone-600">Vacant beds</p>
        {loadError ? (
          <FormError>{loadError} — reload the page to try again.</FormError>
        ) : sites === null ? (
          <p className="text-sm text-stone-400">Loading your sites…</p>
        ) : sites.length === 0 ? (
          <p className="text-sm text-stone-400">
            No sites yet. Add a site with rooms and beds first.
          </p>
        ) : rooms === null ? (
          <p className="text-sm text-stone-400">Loading beds…</p>
        ) : vacant.length === 0 ? (
          <p className="text-sm text-stone-400">No vacant beds in this site.</p>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {vacant.map((b) => (
              <label
                key={b.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition duration-150 ease-out hover:bg-stone-50"
              >
                <input
                  type="radio"
                  name="bed"
                  value={b.id}
                  checked={value?.id === b.id}
                  onChange={() => onChange(b)}
                  className="accent-indigo-600"
                />
                <span className="text-sm text-stone-700">{b.roomName} · {b.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
