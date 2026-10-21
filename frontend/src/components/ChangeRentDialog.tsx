"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, formatCurrency, formatDay, today } from "@/lib/api";
import { firstDueOnOrAfter, nextDueDate } from "@/lib/rent";
import { Button, Field, FormError, Input, Modal, TOUCH_LINK, useToast } from "@/components/ui";

/**
 * Changing a stay's rent.
 *
 * The default is a new rent FROM A DATE: cycles that began before it keep the
 * rent they were billed at, so a rise on a long stay never turns months
 * already paid into arrears. The owner asked for exactly that, with the other
 * case — the rent was simply typed wrong at move-in — still possible but not
 * in the way. So the correction is a quiet link under the form, not a second
 * button beside Save, and it says what it will do before it does it.
 */
export function ChangeRentDialog({
  open,
  stay,
  token,
  tenantName,
  onSaved,
  onClose,
}: {
  open: boolean;
  stay: Pick<Stay, "id" | "rent_amount" | "rent_cycle" | "start_date" | "rent_changes"> | null;
  token: string;
  tenantName?: string;
  onSaved: (stay: Stay) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"from-date" | "correct">("from-date");
  const [rent, setRent] = useState("");
  const [from, setFrom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reopening on a different stay must not show the previous one's figures.
  useEffect(() => {
    if (!open || !stay) return;
    setMode("from-date");
    setRent("");
    setFrom(nextDueDate(stay.start_date, stay.rent_cycle, today()));
    setError("");
  }, [open, stay]);

  if (!stay) return null;

  const start = stay.start_date.slice(0, 10);
  const paise = Math.round(parseFloat(rent || "0") * 100);
  const takesEffect = from ? firstDueOnOrAfter(start, stay.rent_cycle, from) : "";
  const changes = stay.rent_changes ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setError("");
    if (!(paise > 0)) {
      setError("Enter the new rent.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "from-date") {
        const updated = await staysApi.changeRent(token, stay.id, { rent_amount: paise, effective_date: from });
        toast.success(`Rent is ${formatCurrency(paise)} from ${formatDay(takesEffect)}`);
        onSaved(updated);
      } else {
        const updated = await staysApi.correctRent(token, stay.id, paise);
        toast.success(`Rent corrected to ${formatCurrency(paise)} for the whole stay`);
        onSaved(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change the rent");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "from-date" ? "Change rent" : "Correct the rent for the whole stay"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          {tenantName ? `${tenantName} pays` : "Currently"} {formatCurrency(stay.rent_amount)}/{stay.rent_cycle}.
        </p>

        <Field label="New rent (₹)" required>
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            step="any"
            required
            autoFocus
            placeholder={String(stay.rent_amount / 100)}
            value={rent}
            onChange={(e) => setRent(e.target.value)}
          />
        </Field>

        {mode === "from-date" ? (
          <Field label="Starting from" required>
            <Input
              type="date"
              required
              value={from}
              min={start}
              onChange={(e) => setFrom(e.target.value)}
            />
            <p className="mt-1 text-xs text-stone-500">
              {takesEffect && takesEffect !== from.slice(0, 10)
                ? `That falls mid-cycle, so the new rent starts with the payment due ${formatDay(takesEffect)}. `
                : ""}
              Rent due before {takesEffect ? formatDay(takesEffect) : "then"} stays at what it was billed at.
            </p>
          </Field>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Every {stay.rent_cycle === "monthly" ? "month" : stay.rent_cycle === "weekly" ? "week" : "day"} since{" "}
            {formatDay(start)} will be billed at the new rent, as if it had been entered that way at move-in.
            {changes.length > 1 && " This also removes the rent changes recorded on this stay."}
            {" "}Use this only to fix a mistake — for a rent rise, change it from a date.
          </p>
        )}

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : mode === "from-date" ? "Save" : "Correct whole stay"}
          </Button>
        </div>

        <div className="border-t border-stone-100 pt-3 text-xs text-stone-500">
          {mode === "from-date" ? (
            <>
              Entered it wrong at move-in?{" "}
              <button type="button" onClick={() => { setMode("correct"); setError(""); }}
                className={`${TOUCH_LINK} font-medium text-indigo-700 hover:underline`}>
                Correct the whole stay instead
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setMode("from-date"); setError(""); }}
              className={`${TOUCH_LINK} font-medium text-indigo-700 hover:underline`}>
              ← Change it from a date instead
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
