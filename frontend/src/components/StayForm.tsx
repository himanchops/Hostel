"use client";

import { useEffect, useState } from "react";
import {
  gridApi, sitesApi,
  GridRoom, Site,
  today,
} from "@/lib/api";
import { Field, Input, Select } from "@/components/ui";

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
 * daily one. That is the same drift `EndStayDialog` was created to end, and the
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
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<GridRoom[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    sitesApi
      .list(token)
      .then((s) => {
        if (cancelled) return;
        setSites(s);
        if (s.length > 0) setSiteId((prev) => prev ?? s[0].id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    // Null means "still loading" — distinct from an empty list, which means
    // "this site is full" and deserves saying out loud.
    setRooms(null);
    onChange(null);
    gridApi
      .get(token, siteId)
      .then((g) => { if (!cancelled) setRooms(g); })
      .catch(() => { if (!cancelled) setRooms([]); });
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
      {sites.length > 1 && (
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
        {sites.length === 0 ? (
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
