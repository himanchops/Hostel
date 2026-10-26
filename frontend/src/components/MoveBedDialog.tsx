"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, formatCurrency, formatDay, today } from "@/lib/api";
import { cycleContaining, nextDueDate } from "@/lib/rent";
import { BedPicker, VacantBed } from "@/components/StayForm";
import { Button, Field, FormError, Input, Modal, SegmentedControl, useToast } from "@/components/ui";

type RentChoice = "keep" | "new";
type RentFrom = "this_cycle" | "next_cycle";

const CYCLE_WORD = { monthly: "month", weekly: "week", daily: "day" } as const;

/** "17 Oct": short enough for two choices side by side at 375px. */
function shortDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

/**
 * Moving a tenant to another bed (owner, 24 Oct 2026). The stay carries on, so
 * the deposit, payments, balance and rent day are untouched; the old bed is
 * free straight away.
 *
 * A different room can mean a different rent. The app bills whole cycles, so
 * the new rent starts with the cycle the move falls in or the next one, and
 * the owner picks which. "This month" is the owner's own case: moved after a
 * day and paid the whole month's difference. No day-counting, on purpose.
 */
export function MoveBedDialog({
  open,
  stay,
  token,
  tenantName,
  onMoved,
  onClose,
}: {
  open: boolean;
  stay: Pick<Stay, "id" | "rent_amount" | "rent_cycle" | "start_date" | "room_name" | "bed_name"> | null;
  token: string;
  tenantName?: string;
  onMoved: (stay: Stay) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [movedOn, setMovedOn] = useState("");
  const [bed, setBed] = useState<VacantBed | null>(null);
  const [rentChoice, setRentChoice] = useState<RentChoice>("keep");
  const [rent, setRent] = useState("");
  const [rentFrom, setRentFrom] = useState<RentFrom>("this_cycle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reopening on a different stay must not show the previous one's choices.
  useEffect(() => {
    if (!open || !stay) return;
    setMovedOn(today());
    setBed(null);
    setRentChoice("keep");
    setRent("");
    setRentFrom("this_cycle");
    setError("");
  }, [open, stay]);

  if (!stay) return null;

  const start = stay.start_date.slice(0, 10);
  const word = CYCLE_WORD[stay.rent_cycle];
  const thisCycle = movedOn ? cycleContaining(start, stay.rent_cycle, movedOn) : "";
  const nextCycle = movedOn ? nextDueDate(start, stay.rent_cycle, movedOn) : "";
  const paise = Math.round(parseFloat(rent || "0") * 100);
  const from = rentFrom === "this_cycle" ? thisCycle : nextCycle;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setError("");
    if (!movedOn) { setError("Pick the day they moved."); return; }
    if (!bed) { setError("Pick the bed they're moving to."); return; }
    if (rentChoice === "new" && !(paise > 0)) { setError("Enter the new rent."); return; }
    setLoading(true);
    try {
      const updated = await staysApi.move(token, stay.id, {
        bed_id: bed.id,
        moved_on: movedOn,
        ...(rentChoice === "new" ? { rent_amount: paise, rent_from: rentFrom } : {}),
      });
      toast.success(
        `Moved to ${bed.roomName} · ${bed.name}` +
        (rentChoice === "new" ? `, ${formatCurrency(paise)} from ${formatDay(from)}` : ""),
      );
      onMoved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to move them");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={tenantName ? `Move ${tenantName}` : "Move to another bed"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          Now in {stay.room_name && stay.bed_name ? `${stay.room_name} · ${stay.bed_name}` : "their bed"} at{" "}
          {formatCurrency(stay.rent_amount)}/{stay.rent_cycle}.
        </p>

        <Field label="Moving on" required>
          <Input type="date" required value={movedOn} min={start} onChange={(e) => setMovedOn(e.target.value)} />
        </Field>

        <BedPicker token={token} value={bed} onChange={setBed} />

        <div>
          <p className="mb-1 text-[13px] font-medium text-stone-600">Rent</p>
          <SegmentedControl
            options={[
              { value: "keep", label: `Keep ${formatCurrency(stay.rent_amount)}` },
              { value: "new", label: "New rent" },
            ] as const}
            value={rentChoice}
            onChange={(v) => setRentChoice(v as RentChoice)}
            ariaLabel="Rent"
          />
        </div>

        {rentChoice === "new" && (
          <>
            <Field label="New rent (₹)" required>
              <Input
                type="number"
                inputMode="decimal"
                min="1"
                step="any"
                required
                placeholder={String(stay.rent_amount / 100)}
                value={rent}
                onChange={(e) => setRent(e.target.value)}
              />
            </Field>
            <div>
              <p className="mb-1 text-[13px] font-medium text-stone-600">New rent starts</p>
              <SegmentedControl
                options={[
                  {
                    value: "this_cycle",
                    label: thisCycle === start ? `From move-in · ${shortDay(start)}` : `This ${word} · ${shortDay(thisCycle)}`,
                  },
                  { value: "next_cycle", label: `Next ${word} · ${shortDay(nextCycle)}` },
                ] as const}
                value={rentFrom}
                onChange={(v) => setRentFrom(v as RentFrom)}
                ariaLabel="New rent starts"
              />
              <p className="mt-1 text-xs text-stone-500">
                {from === start
                  ? "The whole stay is billed at the new rent."
                  : `Rent due before ${formatDay(from)} stays at what it was billed at.`}
              </p>
            </div>
          </>
        )}

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Moving…" : "Move"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
