"use client";

import { useCallback, useEffect, useState } from "react";
import {
  settlementsApi, staysApi, ApiError, formatCurrency,
  Adjustment, Settlement, SettlementPreview, Stay,
} from "@/lib/api";
import { dueDay, localToday } from "@/lib/due";
import { PAY_METHODS, PayMethod } from "@/lib/payMethod";
import {
  moveOutSettlement, parseRupees, cycleCountLabel, advanceHeld, depositLine,
} from "@/lib/settlement";
import {
  Button, Drawer, Field, FormError, Input, SegmentedControl, Skeleton, useToast,
} from "@/components/ui";

/**
 * Moving a tenant out, in the order it happens at the door: the day they
 * leave, the money, and what you hand back.
 *
 * It replaces three controls that each did part of this — "End without
 * settling", "Settle & vacate" and the grid's "End stay", which freed the bed
 * and never touched the money — so there is one way out, from the tenant page
 * and the grid alike.
 *
 * The opening position follows the house rules (lib/settlement.ts →
 * moveOutSettlement): rent is never refunded, and the deposit comes back only
 * to someone who gave notice. Every one of those is a proposal. The owner has
 * the last word, and the amount handed back is a box they can type into.
 */

type Leaving = "today" | "said" | "other";
type Deduction = { id: number; label: string; amount: string };
let nextId = 1;

export function MoveOutSheet({
  open,
  stayId,
  token,
  tenantName,
  onDone,
  onClose,
}: {
  open: boolean;
  stayId: number | null;
  token: string;
  tenantName?: string;
  /** Settled (and ended, if it was open), or ended with the money left for later. */
  onDone: (result: { settlement?: Settlement; ended?: Stay }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const first = tenantName?.trim().split(/\s+/)[0] ?? "They";
  const today = localToday();

  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState<Leaving>("today");
  const [otherDate, setOtherDate] = useState(today);
  // The deposit decision. Null until the stay loads, then the house rule's
  // answer; after that, whatever the owner picks.
  const [returnDeposit, setReturnDeposit] = useState<boolean | null>(null);
  // A notice the owner forgot to record, recorded from here.
  const [addingNotice, setAddingNotice] = useState(false);
  const [noticeDate, setNoticeDate] = useState("");
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  // What the owner typed over the proposed amount; null means "as proposed".
  const [typed, setTyped] = useState<string | null>(null);
  const [showWorking, setShowWorking] = useState(false);
  const [method, setMethod] = useState<PayMethod>("cash");
  const [addingNote, setAddingNote] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A fresh sheet every time: a leftover deduction from the last tenant would
  // be a real money mistake.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setLeaving("today");
    setOtherDate(today);
    setReturnDeposit(null);
    setAddingNotice(false);
    setNoticeDate("");
    setDeductions([]);
    setTyped(null);
    setShowWorking(false);
    setMethod("cash");
    setAddingNote(false);
    setNotes("");
    setError("");
  }, [open, stayId, today]);

  const said = preview?.expected_end_date && preview.expected_end_date < today ? preview.expected_end_date : null;
  const endDate = leaving === "today" ? today : leaving === "said" && said ? said : otherDate;

  const load = useCallback(async (date: string, signal: { cancelled: boolean }) => {
    if (stayId === null) return;
    setLoading(true);
    try {
      const p = await settlementsApi.preview(token, stayId, date);
      if (signal.cancelled) return;
      setPreview(p);
      // The rule's answer, once: any notice gets the deposit back.
      setReturnDeposit((prev) => (prev === null ? Boolean(p.notice_date) : prev));
      setTyped(null); // a new date is a new sum; never keep a figure typed against the old one
      setError("");
    } catch (err) {
      if (!signal.cancelled) setError(err instanceof ApiError ? err.message : "Could not work out the money");
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, [token, stayId]);

  useEffect(() => {
    if (!open || stayId === null) return;
    const signal = { cancelled: false };
    load(endDate, signal);
    return () => { signal.cancelled = true; };
  }, [open, stayId, endDate, load]);

  const parsedDeductions: Adjustment[] = deductions.flatMap((d) => {
    const paise = parseRupees(d.amount);
    return paise !== null && d.label.trim() ? [{ label: d.label.trim(), amount_paise: -paise }] : [];
  });
  const badDeduction = deductions.some(
    (d) => (d.label.trim() || d.amount.trim()) && (parseRupees(d.amount) === null || !d.label.trim()),
  );

  const proposed = preview
    ? moveOutSettlement(preview.deposit_paise, preview.dues_paise, {
        returnDeposit: returnDeposit ?? false, deductions: parsedDeductions,
      }).proposed
    : 0;
  const owes = proposed < 0;
  const typedPaise = typed === null ? null : parseRupees(typed);
  const badTyped = typed !== null && typedPaise === null;
  const final = typedPaise === null ? undefined : owes ? -typedPaise : typedPaise;
  const sum = preview
    ? moveOutSettlement(preview.deposit_paise, preview.dues_paise, {
        returnDeposit: returnDeposit ?? false, deductions: parsedDeductions, finalRefund: final,
      })
    : null;
  const refund = sum?.refund ?? 0;

  const advance = preview ? advanceHeld(preview.dues_paise) : 0;
  const kept = sum?.adjustments.find((a) => a.label.startsWith("Deposit kept"))?.amount_paise ?? 0;
  const ended = preview?.already_ended ?? false;
  const blocked = !preview || loading || badDeduction || badTyped || (addingNotice && !noticeDate);

  async function recordNotice() {
    if (stayId !== null && addingNotice && noticeDate) {
      await staysApi.update(token, stayId, { notice_date: noticeDate });
    }
  }

  async function handleSettle() {
    if (stayId === null || !preview || !sum) return;
    setError("");
    setSaving(true);
    try {
      await recordNotice();
      const settlement = await settlementsApi.create(token, stayId, {
        adjustments: sum.adjustments,
        refund_paise: sum.refund,
        // Rent is never refunded: rent paid for after they leave is kept.
        advance_returned_paise: 0,
        end_date: ended ? undefined : endDate,
        refund_method: sum.refund > 0 ? method : undefined,
        notes: notes.trim() || undefined,
      });
      const did = ended ? "settled" : "moved out";
      toast.success(
        sum.refund > 0 ? `${first} ${did} · ${formatCurrency(sum.refund)} handed back`
          : sum.refund < 0 ? `${first} ${did} · owes ${formatCurrency(-sum.refund)}`
          : `${first} ${did}`,
      );
      onDone({ settlement });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the move-out. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLater() {
    if (stayId === null) return;
    setError("");
    setSaving(true);
    try {
      await recordNotice();
      const stay = await staysApi.update(token, stayId, { end_date: endDate });
      toast.success(`${first} moved out · money to settle later`);
      onDone({ ended: stay });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the move-out. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const action = ended ? "Settle" : "Move out";
  const label = refund > 0 ? `${action} · hand back ${formatCurrency(refund)}`
    : refund < 0 ? `${action} · they owe ${formatCurrency(-refund)}`
    : action;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tenantName ? `${ended ? "Settle the money" : "Move out"} · ${tenantName}` : ended ? "Settle the money" : "Move out"}
      width="lg"
      footer={
        <div className="space-y-2">
          <Button className="w-full" onClick={handleSettle} loading={saving} disabled={blocked}>
            {saving ? "Saving…" : label}
          </Button>
          {!ended && (
            <Button variant="ghost" size="sm" className="w-full" onClick={handleLater} disabled={saving || !preview}>
              They&apos;ve left · settle the money later
            </Button>
          )}
        </div>
      }
    >
      {!preview ? (
        loading || !error ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <FormError>{error}</FormError>
        )
      ) : (
        <div className="space-y-5">
          {/* 1. The day they leave */}
          <section>
            <h3 className="mb-1.5 text-[13px] font-medium text-stone-600">{ended ? "Left on" : "Leaving on"}</h3>
            {ended ? (
              <p className="text-sm text-stone-800">{dueDay(preview.end_date)}</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <SegmentedControl<Leaving>
                  ariaLabel="Leaving on"
                  value={leaving}
                  onChange={setLeaving}
                  options={[
                    { value: "today", label: "Today" },
                    ...(said ? [{ value: "said" as const, label: `${dueDay(said)}, as they said` }] : []),
                    { value: "other", label: "Another day" },
                  ]}
                />
                {leaving === "other" && (
                  <Input
                    type="date"
                    aria-label="Leaving date"
                    value={otherDate}
                    min={preview.start_date}
                    max={today}
                    onChange={(e) => e.target.value && setOtherDate(e.target.value)}
                    className="w-auto"
                  />
                )}
              </div>
            )}
          </section>

          {/* 2. The notice, and so the deposit */}
          <section className="space-y-2">
            <h3 className="text-[13px] font-medium text-stone-600">Deposit</h3>
            {(() => {
              const n = noticeLine(preview, addingNotice ? noticeDate : "");
              return <p className={`text-sm ${n.tone}`}>{n.text}</p>;
            })()}
            {!preview.notice_date && !addingNotice && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setAddingNotice(true); setNoticeDate(today); setReturnDeposit(true); }}
              >
                They gave notice
              </Button>
            )}
            {addingNotice && (
              <Field label="When did they tell you?">
                <Input
                  type="date"
                  value={noticeDate}
                  min={preview.start_date}
                  max={today}
                  onChange={(e) => setNoticeDate(e.target.value)}
                  className="w-auto"
                />
              </Field>
            )}
            {preview.deposit_paise > 0 && (
              <SegmentedControl<"back" | "keep">
                ariaLabel="Deposit"
                value={returnDeposit ? "back" : "keep"}
                onChange={(v) => { setReturnDeposit(v === "back"); setTyped(null); }}
                options={[
                  { value: "back", label: "Give it back" },
                  { value: "keep", label: "Keep it" },
                ]}
              />
            )}
          </section>

          {/* 3. The money, as a sum that adds up to the answer */}
          <section className="space-y-1.5 rounded-xl bg-stone-50 p-4 text-sm">
            <Line label="Deposit you hold" value={formatCurrency(preview.deposit_paise)} />
            {depositLine(preview.deposit_agreed_paise, preview.deposit_paise) && (
              <p className="text-xs tabular-nums text-stone-500">
                {depositLine(preview.deposit_agreed_paise, preview.deposit_paise)}. Only money received comes back.
              </p>
            )}
            {preview.dues_paise > 0 && (
              <Line
                label={
                  <>
                    Rent still owed{" "}
                    <button
                      type="button"
                      onClick={() => setShowWorking(!showWorking)}
                      aria-expanded={showWorking}
                      className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {showWorking ? "hide" : "how?"}
                    </button>
                  </>
                }
                value={`− ${formatCurrency(preview.dues_paise)}`}
                tone="danger"
              />
            )}
            {showWorking && preview.dues_paise > 0 && (
              <p className="text-xs tabular-nums text-stone-500">
                {cycleCountLabel(preview.rent_cycle, preview.cycles_billed)} billed, whole months up to the day
                they leave: {formatCurrency(preview.total_expected)} · {formatCurrency(preview.total_paid)} paid
              </p>
            )}
            {kept < 0 && <Line label="Deposit kept: no notice" value={`− ${formatCurrency(-kept)}`} tone="danger" />}
            {advance > 0 && (
              <p className="text-xs tabular-nums text-stone-500">
                {formatCurrency(advance)} of rent paid for after they leave is kept. Rent isn&apos;t refunded.
              </p>
            )}

            {deductions.map((d) => (
              <div key={d.id} className="flex items-center gap-2 pt-1">
                <Input
                  placeholder="What for?"
                  aria-label="Taken off for"
                  value={d.label}
                  onChange={(e) => setDeductions((all) => all.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)))}
                  className="min-w-0 flex-1"
                />
                <Input
                  inputMode="decimal"
                  placeholder="₹"
                  aria-label="Amount taken off"
                  value={d.amount}
                  onChange={(e) => setDeductions((all) => all.map((x) => (x.id === d.id ? { ...x, amount: e.target.value } : x)))}
                  className="w-28"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove"
                  onClick={() => setDeductions((all) => all.filter((x) => x.id !== d.id))}
                >
                  ✕
                </Button>
              </div>
            ))}
            {badDeduction && (
              <p className="text-[13px] text-red-600">Say what each one is for, with an amount like 500.</p>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDeductions((all) => [...all, { id: nextId++, label: "", amount: "" }]); setTyped(null); }}
            >
              + Take something off
            </Button>
          </section>

          {/* 4. The answer, which the owner can change */}
          <section className={`rounded-xl p-4 ${owes ? "bg-overdue-50" : "bg-paid-50"}`}>
            <Field label={owes ? `${first} owes you (₹)` : "Hand back (₹)"}>
              <Input
                inputMode="decimal"
                value={typed ?? String(Math.abs(proposed) / 100)}
                onChange={(e) => setTyped(e.target.value)}
                className="w-40 text-lg font-semibold"
              />
            </Field>
            {badTyped && <p className="mt-1 text-[13px] text-red-600">Enter an amount like 6500.</p>}
            {typed !== null && !badTyped && final !== proposed && (
              <p className="mt-1 text-xs text-stone-600">
                Changed by you from {formatCurrency(Math.abs(proposed))}.{" "}
                <button type="button" onClick={() => setTyped(null)} className="font-medium text-indigo-600 hover:underline">
                  Undo
                </button>
              </p>
            )}
            {refund > 0 && (
              <div className="mt-3">
                <span className="mb-1 block text-[13px] font-medium text-stone-600">Paid back by</span>
                <SegmentedControl options={PAY_METHODS} value={method} onChange={setMethod} ariaLabel="Paid back by" />
              </div>
            )}
          </section>

          {addingNote ? (
            <Field label="Note">
              <Input autoFocus placeholder="Anything to remember about this move-out" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setAddingNote(true)}>+ Note</Button>
          )}

          {error && <FormError>{error}</FormError>}
        </div>
      )}
    </Drawer>
  );
}

function Line({ label, value, tone }: { label: React.ReactNode; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-stone-600">{label}</span>
      <span className={`font-semibold tabular-nums ${tone === "danger" ? "text-red-700" : "text-stone-900"}`}>{value}</span>
    </div>
  );
}

/**
 * The one line that says why the deposit defaults the way it does. Notice is
 * due by the start of their last rent month (`notice_by`, from the server);
 * dates compare as strings because both are "YYYY-MM-DD".
 */
function noticeLine(p: SettlementPreview, recorded: string): { text: string; tone: string } {
  const notice = p.notice_date ?? (recorded || null);
  if (!notice) return { text: "No notice given, so the deposit is kept by default.", tone: "text-red-700" };
  if (notice <= p.notice_by) return { text: `Gave notice ${dueDay(notice)}, in time.`, tone: "text-stone-700" };
  return {
    text: `Gave notice ${dueDay(notice)}, less than a month before leaving (due by ${dueDay(p.notice_by)}).`,
    tone: "text-amber-800",
  };
}
