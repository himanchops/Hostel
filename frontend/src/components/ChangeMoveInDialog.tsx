"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, formatDay, today } from "@/lib/api";
import { Button, Field, FormError, Input, Modal, useToast } from "@/components/ui";

/** "15th" — the day of the month a monthly rent falls due. */
function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Saturday" from "2026-11-15", without a Date in local time, so no timezone moves it. */
function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * What moving the date will mean, in one line. The move-in day is also the
 * rent day (cycleStart, handlers/collections.go), which is usually why
 * the date is being moved at all.
 */
export function moveInHint(date: string, cycle: Stay["rent_cycle"], hasBed: boolean, now: string): string {
  const parts: string[] = [];
  if (cycle === "monthly") {
    const day = Number(date.slice(8, 10));
    // A month too short for the day falls due on its last day (S1 clamping).
    parts.push(`Rent falls due on the ${ordinal(day)} of each month${day > 28 ? ", or the last day of a shorter one" : ""}.`);
  }
  if (cycle === "weekly") parts.push(`Rent falls due every ${weekday(date)}.`);
  if (hasBed && date > now) parts.push("Until then the bed reads arriving.");
  return parts.join(" ");
}

/**
 * Moving the day a stay began: someone written down for the 10th who came on
 * the 15th, or a month that runs from a different day than was typed. It moves
 * the rent day with it. Payments already recorded still count.
 */
export function ChangeMoveInDialog({
  open,
  stay,
  token,
  tenantName,
  onSaved,
  onClose,
}: {
  open: boolean;
  stay: Pick<Stay, "id" | "start_date" | "rent_cycle" | "bed_id"> | null;
  token: string;
  tenantName?: string;
  onSaved: (stay: Stay) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !stay) return;
    setDate(stay.start_date.slice(0, 10));
    setError("");
  }, [open, stay]);

  const current = stay?.start_date.slice(0, 10) ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    if (!date) { setError("Pick the day they moved in."); return; }
    if (date === current) { onClose(); return; }
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.update(token, stay.id, { start_date: date });
      toast.success(`Moved in ${formatDay(date)}`);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change the move-in date");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change move-in date">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label={tenantName ? `When did ${tenantName} move in?` : "When did they move in?"}
          hint={stay && date ? moveInHint(date, stay.rent_cycle, stay.bed_id != null, today()) : undefined}
        >
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </Field>

        {error && <FormError>{error}</FormError>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
