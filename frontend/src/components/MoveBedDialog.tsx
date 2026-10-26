"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, formatCurrency, today } from "@/lib/api";
import { BedPicker, VacantBed } from "@/components/StayForm";
import {
  RentChoiceFields, RentChoiceValue, RentSummary, emptyRentChoice, rentPlanOf, useRentPreview,
} from "@/components/RentChoice";
import { Button, Field, FormError, Input, Modal, SegmentedControl, TOUCH_LINK, useToast } from "@/components/ui";

/**
 * Moving a tenant to another bed. The stay carries on, so the deposit,
 * payments, balance and rent day are untouched, and the old bed is free
 * straight away.
 *
 * The everyday move is pick a bed, press Move: the day is today unless the
 * owner says otherwise, and the rent stays unless she says it changes. When it
 * does, the question is the owner's own (RentChoice.tsx), with the move day as
 * "this month", and a line that says what it will mean before she saves.
 *
 * `targetBed` fixes the bed: the grid's empty-bed drawer opens this for
 * someone who already lives here (owner, 26 Oct 2026).
 */
export function MoveBedDialog({
  open,
  stay,
  token,
  tenantName,
  targetBed,
  onMoved,
  onClose,
}: {
  open: boolean;
  stay: Pick<Stay, "id" | "rent_amount" | "rent_cycle" | "start_date" | "room_name" | "bed_name"> | null;
  token: string;
  tenantName?: string;
  targetBed?: VacantBed;
  onMoved: (stay: Stay) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [movedOn, setMovedOn] = useState("");
  const [pickDay, setPickDay] = useState(false);
  const [bed, setBed] = useState<VacantBed | null>(null);
  const [changes, setChanges] = useState<"no" | "yes">("no");
  const [rent, setRent] = useState<RentChoiceValue>(emptyRentChoice());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reopening on a different stay must not show the previous one's choices.
  useEffect(() => {
    if (!open || !stay) return;
    setMovedOn(today());
    setPickDay(false);
    setBed(targetBed ?? null);
    setChanges("no");
    setRent(emptyRentChoice());
    setError("");
  }, [open, stay, targetBed]);

  const plan = changes === "yes" ? rentPlanOf(rent) : null;
  // The rent as it stands, for the labels: this cycle's, not the latest set.
  const { preview: current } = useRentPreview(token, open && stay ? stay.id : null, movedOn, null);
  const { preview, error: previewError } = useRentPreview(
    token,
    open && stay ? stay.id : null,
    movedOn,
    plan && !("error" in plan) ? plan : null,
  );

  if (!stay) return null;
  const start = stay.start_date.slice(0, 10);
  const target = targetBed ?? bed;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setError("");
    if (!movedOn) { setError("Pick the day they moved."); return; }
    if (!target) { setError("Pick the bed they're moving to."); return; }
    if (plan && "error" in plan) { setError(plan.error); return; }
    setLoading(true);
    try {
      const updated = await staysApi.move(token, stay.id, {
        bed_id: target.id,
        moved_on: movedOn,
        ...(plan ? { rent: plan } : {}),
      });
      toast.success(`Moved to ${target.roomName} · ${target.name}`);
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
          Now in {stay.room_name && stay.bed_name ? `${stay.room_name} · ${stay.bed_name}` : "their bed"}
          {current && <> at {formatCurrency(current.this_rent)} a {stay.rent_cycle === "monthly" ? "month" : stay.rent_cycle === "weekly" ? "week" : "day"}</>}.
        </p>

        {targetBed ? (
          <p className="text-sm font-medium text-stone-800">Moving to {targetBed.roomName} · {targetBed.name}</p>
        ) : (
          <BedPicker token={token} value={bed} onChange={setBed} />
        )}

        {pickDay ? (
          <Field label="Moved on" required>
            <Input type="date" required value={movedOn} min={start} onChange={(e) => setMovedOn(e.target.value)} />
          </Field>
        ) : (
          <button type="button" onClick={() => setPickDay(true)}
            className={`${TOUCH_LINK} text-sm font-medium text-indigo-700 hover:underline`}>
            Moved on an earlier day?
          </button>
        )}

        <div>
          <p className="mb-1 text-[13px] font-medium text-stone-600">Does the rent change?</p>
          <SegmentedControl
            ariaLabel="Does the rent change?"
            options={[
              { value: "no", label: current ? `No, stays ${formatCurrency(current.this_rent)}` : "No" },
              { value: "yes", label: "Yes" },
            ] as const}
            value={changes}
            onChange={(v) => setChanges(v)}
          />
        </div>

        {changes === "yes" && movedOn && (
          <RentChoiceFields stay={stay} refDate={movedOn} currentRent={current?.this_rent ?? null} value={rent} onChange={setRent} />
        )}

        {(changes === "no" || (plan && !("error" in plan))) && (
          <RentSummary preview={preview} error={previewError} cycle={stay.rent_cycle} unchanged={changes === "no"} />
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
