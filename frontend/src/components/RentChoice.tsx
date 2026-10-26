"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, RentPlan, RentPreview, ApiError, formatCurrency } from "@/lib/api";
import { cycleContaining, nextDueDate } from "@/lib/rent";
import { ChoiceList, Field, Input } from "@/components/ui";

/**
 * A rent change asked the way the owner says it (26 Oct 2026), shared by Move
 * bed and Change rent:
 *
 *   From next month, rent is ₹___
 *   This month, they pay: the old rent / the new rent / an amount you agreed
 *
 * and a line under it saying what that will mean, worked out by the server
 * (handlers/rentplan.go) so it cannot disagree with the tenant's page after.
 * It replaced "the new rent starts from <date>", which left the owner working
 * out the consequence herself.
 */

export type ThisCycle = RentPlan["this_cycle"];

export interface RentChoiceValue {
  nextRent: string; // rupees, as typed
  thisCycle: ThisCycle;
  agreed: string; // rupees, as typed
}

export function emptyRentChoice(): RentChoiceValue {
  return { nextRent: "", thisCycle: "old", agreed: "" };
}

const paise = (rupees: string) => Math.round(parseFloat(rupees || "0") * 100);

/** The plan to send, or an error to show. */
export function rentPlanOf(v: RentChoiceValue): RentPlan | { error: string } {
  if (!(paise(v.nextRent) > 0)) return { error: "Enter the new rent." };
  if (v.thisCycle === "agreed" && !(paise(v.agreed) > 0)) return { error: "Enter the amount you agreed for this month." };
  return {
    next_rent: paise(v.nextRent),
    this_cycle: v.thisCycle,
    ...(v.thisCycle === "agreed" ? { agreed: paise(v.agreed) } : {}),
  };
}

const CYCLE_WORD = { monthly: "month", weekly: "week", daily: "day" } as const;

/** "17 Oct": short enough for a label at 375px. */
export function shortDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

type RentStay = Pick<Stay, "id" | "rent_amount" | "rent_cycle" | "start_date">;

export function RentChoiceFields({
  stay,
  refDate,
  currentRent,
  value,
  onChange,
}: {
  stay: RentStay;
  /** The day the change is made: the move day, or today. */
  refDate: string;
  /**
   * This cycle's rent, from the server's preview. Not stays.rent_amount,
   * which is the latest scheduled rent: with a rise already set for next
   * month, that would call next month's rent "the old rent".
   */
  currentRent: number | null;
  value: RentChoiceValue;
  onChange: (next: RentChoiceValue) => void;
}) {
  const set = (patch: Partial<RentChoiceValue>) => onChange({ ...value, ...patch });
  const start = stay.start_date.slice(0, 10);
  const word = CYCLE_WORD[stay.rent_cycle];
  const thisStart = cycleContaining(start, stay.rent_cycle, refDate);
  const nextStart = nextDueDate(start, stay.rent_cycle, refDate);
  const newRent = paise(value.nextRent);

  return (
    <div className="space-y-4">
      <Field label={`From next ${word} (${shortDay(nextStart)}), rent is (₹)`} required>
        <Input
          type="number"
          inputMode="decimal"
          min="1"
          step="any"
          required
          placeholder={String(stay.rent_amount / 100)}
          value={value.nextRent}
          onChange={(e) => set({ nextRent: e.target.value })}
        />
      </Field>
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-stone-600">
          This {word} ({shortDay(thisStart)} – {shortDay(dayBefore(nextStart))}), they pay
        </p>
        <ChoiceList
          ariaLabel={`This ${word}, they pay`}
          value={value.thisCycle}
          onChange={(thisCycle) => set({ thisCycle })}
          options={[
            { value: "old", label: currentRent != null ? `The old rent, ${formatCurrency(currentRent)}` : "The old rent" },
            { value: "new", label: newRent > 0 ? `The new rent, ${formatCurrency(newRent)}` : "The new rent" },
            { value: "agreed", label: "An amount you agreed" },
          ]}
        />
        {value.thisCycle === "agreed" && (
          <Field label={`Agreed for this ${word} (₹)`} required className="mt-3">
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              step="any"
              required
              autoFocus
              value={value.agreed}
              onChange={(e) => set({ agreed: e.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The server's preview of a plan, refetched as the owner types. No plan
 * previews the rent as it stands. Null until it arrives or while the fields
 * are incomplete.
 */
export function useRentPreview(
  token: string,
  stayId: number | null,
  refDate: string,
  plan: RentPlan | null,
): { preview: RentPreview | null; error: string } {
  const [preview, setPreview] = useState<RentPreview | null>(null);
  const [error, setError] = useState("");
  const key = JSON.stringify(plan);

  useEffect(() => {
    if (!stayId || !refDate) return;
    let cancelled = false;
    // Typing a rent fires on every digit; wait for a pause.
    const t = setTimeout(() => {
      staysApi.rentPreview(token, stayId, refDate, plan ?? undefined)
        .then((p) => { if (!cancelled) { setPreview(p); setError(""); } })
        .catch((err) => {
          if (!cancelled) {
            setPreview(null);
            setError(err instanceof ApiError ? err.message : "Could not work out what this means");
          }
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // `key` stands for `plan`, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, stayId, refDate, key]);

  return { preview, error };
}

/**
 * The one line that says what the change means, in money: this cycle's rent,
 * how much of it is paid, what is due now, and the rent from next cycle.
 */
export function RentSummary({
  preview,
  error,
  cycle,
}: {
  preview: RentPreview | null;
  error: string;
  cycle: Stay["rent_cycle"];
}) {
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!preview) return null;
  const word = CYCLE_WORD[cycle];
  const owed = preview.balance > 0
    ? `${formatCurrency(preview.balance)} is due now.`
    : preview.balance < 0
      ? `${formatCurrency(-preview.balance)} is paid ahead.`
      : "Nothing more is due.";
  const range = `${shortDay(preview.this_start)} – ${shortDay(preview.this_end)}`;
  return (
    <p data-testid="rent-summary" className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
      This {word} ({range}) is {formatCurrency(preview.this_rent)}
      {preview.paid_this > 0
        ? `, and ${formatCurrency(preview.paid_this)} of it is paid. `
        : ", and none of it is paid yet. "}
      {owed} From {shortDay(preview.next_start)}, {formatCurrency(preview.next_rent)} a {word}.
    </p>
  );
}
