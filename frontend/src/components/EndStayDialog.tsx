"use client";

import { useState } from "react";
import { staysApi, Stay, ApiError, today } from "@/lib/api";
import { Button, Field, FormError, Input, Modal } from "@/components/ui";

/**
 * Ending a stay, with a date.
 *
 * This exists as one component because the two places that end stays had drifted
 * apart: the tenant page asked for a move-out date, while the grid used
 * window.confirm and hard-coded today, so a departure recorded three days late
 * was billed three days long. Both now render this, so they cannot disagree
 * again (see "Vacate-from-grid can't backfill a date" in docs/PROGRESS.md).
 */
export function EndStayDialog({
  open,
  stayId,
  token,
  tenantName,
  onEnded,
  onClose,
}: {
  open: boolean;
  stayId: number | null;
  token: string;
  /** Shown in the prompt so the owner can see who they are about to move out. */
  tenantName?: string;
  onEnded: (stay: Stay) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stayId === null) return;
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.update(token, stayId, { end_date: date });
      onEnded(updated);
      setDate(today());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to end the stay");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="End stay">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          {tenantName
            ? `${tenantName} will be moved out and the bed freed.`
            : "The tenant will be moved out and the bed freed."}{" "}
          Rent is billed up to the date you pick.
        </p>

        <Field label="Select move-out date:">
          <Input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            {loading ? "Ending…" : "Confirm"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
