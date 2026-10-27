"use client";

import { useEffect, useState } from "react";
import {
  ApiError, Payment, PaymentKind, formatCurrency, formatDay, latestPaymentDate,
  paymentsApi, pendingPaymentsApi,
} from "@/lib/api";
import { PAY_METHODS, PayMethod, payMethodLabel } from "@/lib/payMethod";
import { parseRupees } from "@/lib/settlement";
import { changedLine } from "@/lib/paymentEdit";
import { PaymentStatus, RejectionReason } from "@/components/PaymentStatus";
import {
  Badge, Button, Field, FormError, Input, Modal, SegmentedControl, Select, useConfirm, useToast,
} from "@/components/ui";

/**
 * One payment, opened by tapping its row: what it says, what it said before
 * a change, and the one or two things that can be done about it.
 *
 * Corrections live here rather than as a control on every row (owner, Oct
 * 2026): entering money is everyday, correcting it is rare. The owner's own
 * entries can be changed or deleted. A tenant's can be changed, or marked not
 * accepted, never deleted, so the tenant's ledger keeps what happened. A
 * payment a settlement was worked out from changes only after that
 * settlement is undone, so its figures can't quietly disagree.
 *
 * One component for the tenant page and the bed drawer.
 */
export function PaymentSheet({
  payment,
  token,
  onClose,
  onChanged,
}: {
  payment: Payment | null;
  token: string;
  onClose: () => void;
  /** The payment as it now stands, or `null` when it was deleted. */
  onChanged: (id: number, updated: Payment | null) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<"view" | "change" | "refuse">("view");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<PaymentKind>("rent");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Opening another payment must not show the last one's figures.
  useEffect(() => {
    if (!payment) return;
    setMode("view");
    setAmount(String(payment.amount / 100));
    setKind(payment.kind);
    setMethod(payment.payment_type);
    setDate(payment.payment_date.slice(0, 10));
    setNotes(payment.notes ?? "");
    setReason("");
    setError("");
  }, [payment]);

  if (!payment) return null;
  const p = payment;
  const accepted = p.is_approved;
  const rejected = Boolean(p.rejected_at);
  const waiting = !accepted && !rejected;
  const changed = changedLine(p);

  async function run(action: () => Promise<Payment | null>, done: string) {
    setError("");
    setSaving(true);
    try {
      const updated = await action();
      toast.success(done);
      onChanged(p.id, updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function saveChange(e: React.FormEvent) {
    e.preventDefault();
    const paise = parseRupees(amount);
    if (paise === null || paise <= 0) {
      setError("Type the amount in rupees, like 9000.");
      return;
    }
    run(
      () => paymentsApi.update(token, p.id, {
        amount: paise, kind, payment_type: method, payment_date: date, notes: notes.trim(),
      }),
      "Payment changed",
    );
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${formatCurrency(p.amount)} from ${formatDay(p.payment_date)}?`,
      message: "Use this when the money never came. To fix a figure, use Change instead.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok) run(async () => { await paymentsApi.delete(token, p.id); return null; }, "Payment deleted");
  }

  function refuse(e: React.FormEvent) {
    e.preventDefault();
    run(() => pendingPaymentsApi.reject(token, p.id, reason.trim()), "Marked not accepted");
  }

  function acceptAfterAll() {
    run(async () => {
      await pendingPaymentsApi.approve(token, p.id);
      return { ...p, is_approved: true, rejected_at: undefined, rejection_reason: undefined };
    }, "Payment accepted");
  }

  const title = (
    <span className="tabular-nums">
      {formatCurrency(p.amount)}
      {p.kind === "deposit" ? " deposit" : " rent"} · {formatDay(p.payment_date)}
    </span>
  );

  return (
    <Modal open onClose={onClose} title={title}>
      {mode === "change" ? (
        <form onSubmit={saveChange} className="space-y-4">
          <Field label="Amount (₹)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Field label="For">
              <Select value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)} className="w-auto">
                <option value="rent">Rent</option>
                <option value="deposit">Deposit</option>
              </Select>
            </Field>
            {/* Not a Field: a <label> around buttons taps the first one. */}
            <div>
              <p className="mb-1 text-[13px] font-medium text-stone-600">Paid by</p>
              <SegmentedControl options={PAY_METHODS} value={method} onChange={setMethod} ariaLabel="Paid by" />
            </div>
          </div>
          <Field label="Date">
            <Input type="date" value={date} max={latestPaymentDate()} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          </Field>
          <Field label="Note">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <FormError>{error}</FormError>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setMode("view"); setError(""); }}>Back</Button>
            <Button type="submit" loading={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      ) : mode === "refuse" ? (
        <form onSubmit={refuse} className="space-y-4">
          <p className="text-sm text-stone-600">
            It stops counting as paid. The tenant still sees it on their page, marked not accepted.
          </p>
          <Field label="Why? (the tenant sees this)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Money never reached the account" autoFocus />
          </Field>
          {error && <FormError>{error}</FormError>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setMode("view"); setError(""); }}>Back</Button>
            <Button type="submit" variant="danger" loading={saving}>Not accepted</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Paid by</dt>
              <dd className="text-stone-800">{payMethodLabel(p.payment_type)}</dd>
            </div>
            {p.notes && (
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Note</dt>
                <dd className="text-right text-stone-800">{p.notes}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Entered by</dt>
              <dd className="text-stone-800">{p.from_tenant ? "The tenant" : "You"}</dd>
            </div>
            {(rejected || waiting) && (
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Status</dt>
                <dd><PaymentStatus payment={p} audience="owner" /></dd>
              </div>
            )}
          </dl>
          <RejectionReason payment={p} />
          {changed && <p className="text-xs text-stone-500">{changed}</p>}

          {p.settled ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
              <Badge tone="info" className="mr-2">Settled</Badge>
              The settlement was worked out from this payment. To change it, undo the settlement first.
            </p>
          ) : waiting ? (
            <p className="text-sm text-stone-600">Waiting for you to accept it, under Pending.</p>
          ) : null}

          {error && <FormError>{error}</FormError>}

          {!p.settled && (accepted || rejected) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {accepted && p.from_tenant && (
                <Button
                  variant="secondary"
                  className="mr-auto text-red-700 ring-red-300 hover:bg-red-50"
                  onClick={() => setMode("refuse")}
                >
                  Not accepted after all…
                </Button>
              )}
              {accepted && !p.from_tenant && (
                <Button
                  variant="secondary"
                  className="mr-auto text-red-700 ring-red-300 hover:bg-red-50"
                  onClick={remove}
                  disabled={saving}
                >
                  Delete…
                </Button>
              )}
              {accepted && <Button onClick={() => setMode("change")}>Change</Button>}
              {rejected && <Button onClick={acceptAfterAll} loading={saving}>Accept after all</Button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
