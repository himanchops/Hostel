"use client";

import { useCallback, useEffect, useState } from "react";
import {
  settlementsApi, ApiError, formatCurrency, today,
  Adjustment, Settlement, SettlementPreview,
} from "@/lib/api";
import { refundFor, parseRupees, cycleCountLabel, advanceHeld } from "@/lib/settlement";
import {
  Button, Drawer, Field, FormError, Input, Select, Skeleton, Textarea, useToast,
} from "@/components/ui";

/**
 * The move-out calculator: deposit held − rent outstanding ± manual
 * adjustments = what changes hands.
 *
 * This replaces a hand calculator, so it shows its working. The owner is going
 * to disagree with the outstanding-rent line at some point — a cycle they
 * thought was waived, a payment recorded against the wrong stay — and a bare
 * "₹8,500 outstanding" gives them nothing to check. The cycle count and the
 * billed-versus-paid figures are there so they can see where it came from and
 * either fix the ledger or override it with an adjustment.
 */

/** One row as the owner is editing it: amount stays a string until it parses. */
type Row = {
  id: number;
  direction: "deduct" | "add";
  label: string;
  amount: string;
};

let nextRowId = 1;

function newRow(): Row {
  return { id: nextRowId++, direction: "deduct", label: "", amount: "" };
}

/** A row counts once it has both a label and an amount that parses. */
function toAdjustment(row: Row): Adjustment | null {
  const paise = parseRupees(row.amount);
  if (paise === null || row.label.trim() === "") return null;
  return {
    label: row.label.trim(),
    amount_paise: row.direction === "deduct" ? -paise : paise,
  };
}

function isBlank(row: Row): boolean {
  return row.label.trim() === "" && row.amount.trim() === "";
}

export function SettleStayDrawer({
  open,
  stayId,
  token,
  tenantName,
  onSettled,
  onClose,
}: {
  open: boolean;
  stayId: number | null;
  token: string;
  tenantName?: string;
  /** Fires after the settlement is recorded and the stay ended. */
  onSettled: (settlement: Settlement) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [endDate, setEndDate] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  // What to do with rent the tenant paid ahead. "all" is the default because
  // it is their money until the owner decides otherwise — but it is a default,
  // not a rule, which is the whole reason this control exists.
  const [advanceChoice, setAdvanceChoice] = useState<"all" | "part" | "none">("all");
  const [advancePart, setAdvancePart] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Fresh calculator every time it opens — a leftover adjustment from the last
  // tenant would be a real money mistake.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setRows([]);
    setAdvanceChoice("all");
    setAdvancePart("");
    setNotes("");
    setError("");
    setEndDate(today());
  }, [open, stayId]);

  const loadPreview = useCallback(
    async (date: string, signal: { cancelled: boolean }) => {
      if (stayId === null) return;
      setLoadingPreview(true);
      try {
        const p = await settlementsApi.preview(token, stayId, date);
        if (signal.cancelled) return;
        setPreview(p);
        // An already-ended stay bills to its own end date, whatever we asked
        // for; take the server's answer so the form shows what it charged.
        if (p.already_ended) setEndDate(p.end_date);
        setError("");
      } catch (err) {
        if (signal.cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not work out the settlement");
      } finally {
        if (!signal.cancelled) setLoadingPreview(false);
      }
    },
    [token, stayId]
  );

  // Refetch when the move-out date moves: the date decides how many cycles are
  // billed, so it changes what the tenant owes.
  useEffect(() => {
    if (!open || stayId === null) return;
    const signal = { cancelled: false };
    loadPreview(endDate, signal);
    return () => { signal.cancelled = true; };
  }, [open, stayId, endDate, loadPreview]);

  const adjustments = rows.map(toAdjustment).filter((a): a is Adjustment => a !== null);
  const incomplete = rows.some((r) => !isBlank(r) && toAdjustment(r) === null);

  const advance = preview ? advanceHeld(preview.dues_paise) : 0;
  const partPaise = parseRupees(advancePart);
  // Clamped so the refund on screen is always a number that could actually
  // happen. Typing 20,000 against a ₹17,000 advance shows the ₹17,000 ceiling
  // and an inline error, rather than quoting a refund the server would reject.
  const advanceReturned =
    advance === 0 ? 0
      : advanceChoice === "all" ? advance
      : advanceChoice === "none" ? 0
      : Math.min(partPaise ?? 0, advance);
  // A "part" that is blank, unparseable, or larger than the advance would be
  // submitted as something the owner did not choose — block instead of guess.
  const badAdvancePart =
    advance > 0 && advanceChoice === "part" && (partPaise === null || partPaise > advance);

  const refund = preview
    ? refundFor(preview.deposit_paise, preview.dues_paise, advanceReturned, adjustments)
    : 0;

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handleSubmit() {
    if (stayId === null || !preview) return;
    setError("");
    setSubmitting(true);
    try {
      const settlement = await settlementsApi.create(token, stayId, {
        adjustments,
        notes: notes.trim() || undefined,
        refund_paise: refund,
        advance_returned_paise: advanceReturned,
        end_date: preview.already_ended ? undefined : endDate,
      });
      toast.success(
        refund >= 0
          ? `Settled — ${formatCurrency(refund)} back to ${tenantName ?? "the tenant"}`
          : `Settled — ${tenantName ?? "the tenant"} owes ${formatCurrency(Math.abs(refund))}`
      );
      onSettled(settlement);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record the settlement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tenantName ? `Settle & vacate — ${tenantName}` : "Settle & vacate"}
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!preview || loadingPreview || incomplete || badAdvancePart}
          >
            {submitting ? "Settling…" : "Settle & vacate"}
          </Button>
        </div>
      }
    >
      {!preview && loadingPreview ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !preview ? (
        <FormError>{error || "Could not load this stay."}</FormError>
      ) : (
        <div className="space-y-5">
          {/* Move-out date */}
          {preview.already_ended ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
              This stay ended on <span className="font-medium tabular-nums">{preview.end_date}</span>.
              Rent is billed up to that date.
            </p>
          ) : (
            <Field
              label="Move-out date"
              hint="Rent is billed up to this date — change it if they left earlier."
            >
              <Input
                type="date"
                value={endDate}
                min={preview.start_date}
                max={today()}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          )}

          {/* The two computed lines, with their working */}
          <div className="space-y-2 rounded-xl bg-stone-50 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-stone-600">Deposit held</span>
              <span className="text-sm font-semibold tabular-nums text-stone-900">
                {formatCurrency(preview.deposit_paise)}
              </span>
            </div>

            {/* Every line here is a term of the sum, so the block always adds
                up to the refund below. The advance line tracks the choice
                rather than the raw figure — showing "+₹17,000" next to a
                ₹17,000 refund because the owner chose to keep it would be the
                drawer contradicting itself. */}
            {preview.dues_paise > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-stone-600">Rent outstanding</span>
                <span className="text-sm font-semibold tabular-nums text-stone-900">
                  −{formatCurrency(preview.dues_paise)}
                </span>
              </div>
            )}
            {advance > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-stone-600">Advance returned</span>
                <span className="text-sm font-semibold tabular-nums text-stone-900">
                  +{formatCurrency(advanceReturned)}
                </span>
              </div>
            )}

            <p className="border-t border-stone-200 pt-2 text-xs tabular-nums text-stone-400">
              {cycleCountLabel(preview.rent_cycle, preview.cycles_billed)}
              {" × "}{formatCurrency(preview.rent_amount)} = {formatCurrency(preview.total_expected)} billed
              {" · "}{formatCurrency(preview.total_paid)} paid
            </p>
          </div>

          {/* Only when there is an advance to decide about. Defaulting to
              "return in full" and hiding the choice would be this app quietly
              making the owner's decision for them. */}
          {advance > 0 && (
            <Field
              label={`${formatCurrency(advance)} paid in advance`}
              hint="Rent beyond what was billed. Yours to settle however you agreed."
            >
              <Select
                value={advanceChoice}
                onChange={(e) => setAdvanceChoice(e.target.value as typeof advanceChoice)}
                aria-label="What to do with the advance"
              >
                <option value="all">Return all of it</option>
                <option value="part">Return part of it</option>
                <option value="none">Do not return it</option>
              </Select>

              {advanceChoice === "part" && (
                <div className="mt-2">
                  <Input
                    inputMode="decimal"
                    placeholder="Amount to return (₹)"
                    value={advancePart}
                    onChange={(e) => setAdvancePart(e.target.value)}
                    aria-label="Advance amount to return"
                    className="w-44"
                  />
                  {badAdvancePart && (
                    <p className="mt-1 text-[13px] text-red-600">
                      Enter an amount up to {formatCurrency(advance)}.
                    </p>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Adjustments — the override, and the reason this beats a calculator */}
          <div>
            <p className="mb-1 text-[13px] font-medium text-stone-600">Adjustments</p>
            <p className="mb-2 text-xs text-stone-400">
              Anything the ledger cannot know: damage, unpaid electricity, a discount you agreed.
            </p>

            {rows.length > 0 && (
              <div className="mb-2 space-y-2">
                {rows.map((row) => (
                  <div key={row.id} className="rounded-lg border border-stone-200 p-2">
                    <Input
                      placeholder="What is it for?"
                      value={row.label}
                      onChange={(e) => updateRow(row.id, { label: e.target.value })}
                      aria-label="Adjustment reason"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Select
                        value={row.direction}
                        onChange={(e) => updateRow(row.id, { direction: e.target.value as Row["direction"] })}
                        className="w-32"
                        aria-label="Deduct or add back"
                      >
                        <option value="deduct">Deduct</option>
                        <option value="add">Add back</option>
                      </Select>
                      <Input
                        inputMode="decimal"
                        placeholder="Amount (₹)"
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                        aria-label="Adjustment amount"
                        className="w-32"
                      />
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                        aria-label="Remove adjustment"
                        className="ml-auto rounded px-2 py-1 text-stone-300 transition duration-150 ease-out hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button variant="secondary" size="sm" onClick={() => setRows((prev) => [...prev, newRow()])}>
              + Add adjustment
            </Button>

            {incomplete && (
              <p className="mt-2 text-[13px] text-red-600">
                Every adjustment needs a reason and a plain amount like 500 or 1,200.
              </p>
            )}
          </div>

          {/* The answer */}
          <div className={`rounded-xl p-4 text-center ${refund >= 0 ? "bg-paid-50" : "bg-overdue-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {refund >= 0 ? "Refund to tenant" : `${tenantName ?? "Tenant"} owes you`}
            </p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${refund >= 0 ? "text-paid-800" : "text-overdue-800"}`}>
              {formatCurrency(Math.abs(refund))}
            </p>
          </div>

          <Field label="Notes" hint="Optional — anything worth remembering about this move-out.">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
            />
          </Field>

          {error && <FormError>{error}</FormError>}

          <p className="text-xs text-stone-400">
            Recording this ends the stay and frees the bed.
          </p>
        </div>
      )}
    </Drawer>
  );
}
