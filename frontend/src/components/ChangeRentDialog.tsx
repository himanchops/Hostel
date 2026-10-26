"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, formatCurrency, formatDay, today } from "@/lib/api";
import { firstDueOnOrAfter, nextDueDate } from "@/lib/rent";
import {
  RentChoiceFields, RentChoiceValue, RentSummary, emptyRentChoice, rentPlanOf, useRentPreview,
} from "@/components/RentChoice";
import { Button, Field, FormError, Input, Modal, TOUCH_LINK, useToast } from "@/components/ui";

type Mode = "plan" | "from-date" | "correct";

/**
 * Changing a stay's rent.
 *
 * The default asks it the owner's way (RentChoice.tsx, 26 Oct 2026): from next
 * month the rent is X, and this month they pay the old rent, the new rent or
 * an amount agreed. That also covers a discount agreed up front ("₹8,000 this
 * month, ₹9,000 after"). A line under it says what it will mean before saving.
 *
 * Two quieter ways stay as links. "A different date" sets a new rent from any
 * date, for a deal further out. "Correct the whole stay" fixes a rent typed
 * wrong at move-in, and says what it will do before it does it.
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
  const [mode, setMode] = useState<Mode>("plan");
  const [choice, setChoice] = useState<RentChoiceValue>(emptyRentChoice());
  const [rent, setRent] = useState("");
  const [from, setFrom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reopening on a different stay must not show the previous one's figures.
  useEffect(() => {
    if (!open || !stay) return;
    setMode("plan");
    setChoice(emptyRentChoice());
    setRent("");
    setFrom(nextDueDate(stay.start_date, stay.rent_cycle, today()));
    setError("");
  }, [open, stay]);

  const plan = mode === "plan" ? rentPlanOf(choice) : null;
  const ready = plan && !("error" in plan) ? plan : null;
  const { preview, error: previewError } = useRentPreview(token, open && stay && ready ? stay.id : null, today(), ready);
  // The rent as it stands, for the labels: this cycle's, not the latest set.
  const { preview: current } = useRentPreview(token, open && stay ? stay.id : null, today(), null);

  if (!stay) return null;

  const start = stay.start_date.slice(0, 10);
  const paise = Math.round(parseFloat(rent || "0") * 100);
  const takesEffect = from ? firstDueOnOrAfter(start, stay.rent_cycle, from) : "";
  const changes = stay.rent_changes ?? [];

  function switchTo(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setError("");
    if (mode === "plan") {
      if (!plan || "error" in plan) { setError(plan?.error ?? "Enter the new rent."); return; }
    } else if (!(paise > 0)) {
      setError("Enter the new rent.");
      return;
    }
    setLoading(true);
    try {
      let updated: Stay;
      if (mode === "plan" && plan && !("error" in plan)) {
        updated = await staysApi.setRent(token, stay.id, plan);
        toast.success(`Rent is ${formatCurrency(plan.next_rent)} from ${formatDay(preview?.next_start ?? nextDueDate(start, stay.rent_cycle, today()))}`);
      } else if (mode === "from-date") {
        updated = await staysApi.changeRent(token, stay.id, { rent_amount: paise, effective_date: from });
        toast.success(`Rent is ${formatCurrency(paise)} from ${formatDay(takesEffect)}`);
      } else {
        updated = await staysApi.correctRent(token, stay.id, paise);
        toast.success(`Rent corrected to ${formatCurrency(paise)} for the whole stay`);
      }
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change the rent");
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "correct" ? "Correct the rent for the whole stay" : "Change rent";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          {tenantName ? `${tenantName} pays` : "Currently"} {formatCurrency(current?.this_rent ?? stay.rent_amount)}/{stay.rent_cycle}
          {current && current.next_rent !== current.this_rent && `, ${formatCurrency(current.next_rent)} from ${formatDay(current.next_start)}`}.
        </p>

        {mode === "plan" ? (
          <>
            <RentChoiceFields stay={stay} refDate={today()} currentRent={current?.this_rent ?? null} value={choice} onChange={setChoice} />
            {ready && <RentSummary preview={preview} error={previewError} cycle={stay.rent_cycle} />}
          </>
        ) : (
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
        )}

        {mode === "from-date" && (
          <Field label="Starting from" required>
            <Input type="date" required value={from} min={start} onChange={(e) => setFrom(e.target.value)} />
            <p className="mt-1 text-xs text-stone-500">
              {takesEffect && takesEffect !== from.slice(0, 10)
                ? `That falls mid-cycle, so the new rent starts with the payment due ${formatDay(takesEffect)}. `
                : ""}
              Rent due before {takesEffect ? formatDay(takesEffect) : "then"} stays at what it was billed at.
            </p>
          </Field>
        )}

        {mode === "correct" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Every {stay.rent_cycle === "monthly" ? "month" : stay.rent_cycle === "weekly" ? "week" : "day"} since{" "}
            {formatDay(start)} will be billed at the new rent, as if it had been entered that way at move-in.
            {changes.length > 1 && " This also removes the rent changes recorded on this stay."}
            {" "}Use this only to fix a mistake.
          </p>
        )}

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : mode === "correct" ? "Correct whole stay" : "Save"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-x-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
          {mode !== "plan" && (
            <button type="button" onClick={() => switchTo("plan")}
              className={`${TOUCH_LINK} font-medium text-indigo-700 hover:underline`}>
              ← This month and next
            </button>
          )}
          {mode !== "from-date" && (
            <button type="button" onClick={() => switchTo("from-date")}
              className={`${TOUCH_LINK} font-medium text-indigo-700 hover:underline`}>
              A different date
            </button>
          )}
          {mode !== "correct" && (
            <button type="button" onClick={() => switchTo("correct")}
              className={`${TOUCH_LINK} font-medium text-indigo-700 hover:underline`}>
              Entered it wrong at move-in?
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
