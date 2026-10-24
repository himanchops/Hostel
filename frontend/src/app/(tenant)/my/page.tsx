"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenantAuth } from "@/contexts/tenantAuth";
import {
  tenantPortalApi,
  uploadApi,
  TenantStay,
  TenantSummary,
  Payment,
  ApiError,
  formatCurrency,
  today,
} from "@/lib/api";
import { dueDay } from "@/lib/due";
import { PAY_METHODS, PayMethod, payMethodLabel } from "@/lib/payMethod";
import { reportError } from "@/lib/reportError";
import { PaymentStatus, RejectionReason } from "@/components/PaymentStatus";
import {
  Badge, Button, Card, EmptyState, Field, FormError, Input, SegmentedControl, useConfirm, useToast, FileInput,
} from "@/components/ui";

export default function TenantPortalPage() {
  const { token, isAuthenticated, isLoading } = useTenantAuth();
  const router = useRouter();
  const [stays, setStays] = useState<TenantStay[]>([]);
  const [summary, setSummary] = useState<TenantSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/my/login");
  }, [isAuthenticated, isLoading, router]);

  // Stays and what they owe come together, so the money line never shows
  // beside a list it does not match. A failure says so: it once fell through
  // to "No stays found", which told a tenant they did not live here.
  const load = useCallback(() => {
    if (!token) return;
    Promise.all([tenantPortalApi.stays(token), tenantPortalApi.summary(token)])
      .then(([s, m]) => { setStays(s); setSummary(m); })
      .catch((err) => { reportError(err); setFailed(true); })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function retry() {
    setLoading(true);
    setFailed(false);
    load();
  }

  // A payment they send changes nothing they owe until the owner confirms it,
  // but the list and the "waiting" line should show it straight away.
  const onUpdate = useCallback((updated: TenantStay) => {
    setStays((prev) => prev.map((s) => s.id === updated.id ? updated : s));
  }, []);

  if (isLoading || loading) {
    return (
      <div className="flex items-center gap-2 pt-8 text-sm text-stone-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Loading…
      </div>
    );
  }

  if (failed) {
    return (
      <EmptyState
        title="Couldn't load your details"
        message="Check your connection and try again."
        action={<Button onClick={retry}>Try again</Button>}
      />
    );
  }

  // Approved with nothing set up yet: the owner chose "Just approve".
  if (stays.length === 0) {
    return (
      <EmptyState
        title="You're approved"
        message="Your room will show here once it's set up."
      />
    );
  }

  const open = stays.find((s) => !s.end_date);

  return (
    <div className="space-y-6">
      {summary && <MoneyCard summary={summary} stays={stays} hasOpenStay={!!open} />}
      {stays.map((stay) => (
        <StayCard
          key={stay.id}
          stay={stay}
          token={token!}
          suggested={stay === open && summary ? suggestedAmount(summary) : 0}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

/** What to fill the payment box with: everything owed, else the next rent. */
function suggestedAmount(summary: TenantSummary): number {
  if (summary.balance > 0) return summary.balance;
  return summary.due_paise ?? 0;
}

/**
 * The first thing a tenant sees: what they owe and when, in the owner's own
 * figures (GET /tenant/summary is the owner's tenant summary). Rent and the
 * deposit are separate lines, as they are everywhere else in the app.
 */
function MoneyCard({ summary, stays, hasOpenStay }: {
  summary: TenantSummary;
  stays: TenantStay[];
  hasOpenStay: boolean;
}) {
  // Someone who has left and is square has nothing to be told.
  if (!hasOpenStay && summary.balance <= 0) return null;

  const owes = summary.balance > 0;
  const waiting = stays
    .flatMap((s) => s.payments)
    .filter((p) => !p.is_approved && !p.rejected_at)
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <Card className={owes ? "bg-overdue-50!" : "bg-paid-50!"}>
      <p className={`font-display text-2xl font-bold tabular-nums ${owes ? "text-overdue-800" : "text-paid-800"}`}>
        {owes ? `You owe ${formatCurrency(summary.balance)}` : "You're paid up"}
      </p>
      {rentLine(summary) && <p className="mt-1 text-sm text-stone-700">{rentLine(summary)}</p>}
      {depositLine(summary) && <p className="mt-1 text-sm text-stone-700">{depositLine(summary)}</p>}
      {waiting > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          {formatCurrency(waiting)} you sent is waiting for the owner to confirm.
        </p>
      )}
    </Card>
  );
}

/** When rent is due, from the backend's dueFor (handlers/due.go), in the tenant's voice. */
function rentLine(s: TenantSummary): string | null {
  if (!s.due_date || !s.due_state) return null;
  const day = dueDay(s.due_date);
  switch (s.due_state) {
    case "overdue":
      return `Rent due since ${day}`;
    case "due_today":
      return `Rent ${formatCurrency(s.due_paise ?? 0)} due today`;
    default:
      return `Next rent ${formatCurrency(s.due_paise ?? 0)} due ${day}`;
  }
}

function depositLine(s: TenantSummary): string | null {
  if (s.deposit_due > 0 && s.deposit_held > 0) {
    return `Deposit: ${formatCurrency(s.deposit_held)} paid, ${formatCurrency(s.deposit_due)} still to pay`;
  }
  if (s.deposit_due > 0) return `Deposit ${formatCurrency(s.deposit_due)} not paid yet`;
  if (s.deposit_held > 0) return `Deposit ${formatCurrency(s.deposit_held)} paid`;
  return null;
}

const PER: Record<TenantStay["rent_cycle"], string> = {
  monthly: "a month",
  weekly: "a week",
  daily: "a night",
};

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StayCard({ stay, token, suggested, onUpdate }: {
  stay: TenantStay;
  token: string;
  /** Paise to fill the payment box with; 0 leaves it empty. */
  suggested: number;
  onUpdate: (updated: TenantStay) => void;
}) {
  const isActive = !stay.end_date;
  const hasNotice = !!stay.notice_date;
  // A stay with no bed is a booking: a place is held, the bed comes on arrival.
  const booking = stay.bed_id == null;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  // No default: cash and UPI are both normal here, and a guessed method is
  // how every tenant payment was once filed as UPI.
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeError, setNoticeError] = useState("");
  // The tenant could previously say THAT they were leaving but not WHEN — the
  // old confirm promised the owner would ring them for the date instead.
  const [leaveDate, setLeaveDate] = useState("");
  const [changingDate, setChangingDate] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  function openPaymentForm() {
    setAmount(suggested > 0 ? String(suggested / 100) : "");
    setMethod(null);
    setShowPaymentForm(true);
  }

  function closePaymentForm() {
    setShowPaymentForm(false);
    setPaymentError("");
    setScreenshot(null);
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setPaymentError("");
    if (!method) {
      setPaymentError("Choose cash or UPI.");
      return;
    }
    setPaymentLoading(true);
    try {
      let proofUrl: string | undefined;
      if (screenshot && method === "online") {
        proofUrl = await uploadApi.tenantUpload(screenshot, token);
      }
      const payment = await tenantPortalApi.submitPayment(token, stay.id, {
        amount: Math.round(parseFloat(amount) * 100),
        payment_type: method,
        notes: notes || undefined,
        proof_url: proofUrl,
      });
      onUpdate({ ...stay, payments: [payment, ...stay.payments] });
      setAmount("");
      setNotes("");
      setScreenshot(null);
      setMethod(null);
      setShowPaymentForm(false);
      toast.success("Sent to the owner to confirm");
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : "Couldn't send that. Please try again.");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function submitNotice(e: React.FormEvent) {
    e.preventDefault();
    setNoticeError("");
    setNoticeLoading(true);
    try {
      const updated = await tenantPortalApi.submitNotice(token, stay.id, leaveDate || undefined);
      onUpdate({
        ...stay,
        notice_date: updated.notice_date as string | undefined,
        expected_end_date: updated.expected_end_date as string | undefined,
      });
      const changed = changingDate;
      setNoticeOpen(false);
      setChangingDate(false);
      toast.success(changed ? "Leaving date changed" : "Notice submitted — your owner has been notified");
    } catch (err) {
      // Inline rather than a toast: the message is about the date field sitting
      // directly above it.
      setNoticeError(
        err instanceof ApiError ? err.message : "Could not submit your notice. Please try again.",
      );
    } finally {
      setNoticeLoading(false);
    }
  }

  async function withdrawNotice() {
    const ok = await confirm({
      title: "Withdraw your notice?",
      message: "You'll be staying on. If you give notice again later, it counts from that day.",
      confirmLabel: "Withdraw notice",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    try {
      await tenantPortalApi.withdrawNotice(token, stay.id);
      onUpdate({ ...stay, notice_date: undefined, expected_end_date: undefined });
      setChangingDate(false);
      toast.success("Notice withdrawn — you're staying");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't withdraw your notice. Please try again.");
    }
  }

  const status = !isActive ? "Moved out" : hasNotice ? "Notice given" : booking ? "Booked" : "Living here";

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Stay header */}
      <div className="px-5 py-4 border-b border-stone-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-stone-900">
              {booking
                ? "Booking"
                : [stay.site_name, stay.room_name, stay.bed_name].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 text-sm text-stone-500">
              {formatCurrency(stay.rent_amount)} {PER[stay.rent_cycle]} · Since {longDate(stay.start_date)}
              {stay.end_date && <> · Left {longDate(stay.end_date)}</>}
            </p>
            {booking && isActive && (
              <p className="mt-0.5 text-sm text-stone-500">You’ll get a bed when you arrive.</p>
            )}
          </div>
          <Badge tone={isActive ? (hasNotice ? "warning" : "success") : "neutral"} className="shrink-0">
            {status}
          </Badge>
        </div>
      </div>

      {/* Notice given: the most important thing on the card until they go,
          so it gets a panel of its own rather than a line of small print, and
          they can change the date or take it back. The owner can do both
          from their side ("They're staying"); so can the tenant. */}
      {isActive && hasNotice && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-4">
          <p className="font-display text-lg font-bold text-amber-900">
            {stay.expected_end_date
              ? `You’re leaving on ${longDate(stay.expected_end_date)}`
              : "You’ve given notice"}
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            Notice given {longDate(stay.notice_date!)}.
            {!stay.expected_end_date && " No leaving date yet."}
            {" "}Rent runs until the owner confirms you’ve moved out.
          </p>

          {changingDate ? (
            <form onSubmit={submitNotice} className="mt-3 space-y-2">
              <Field label={stay.expected_end_date ? "New leaving date" : "Leaving date"}>
                <Input
                  type="date"
                  required
                  value={leaveDate}
                  min={today()}
                  onChange={(e) => setLeaveDate(e.target.value)}
                />
              </Field>
              {noticeError && <FormError>{noticeError}</FormError>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={noticeLoading}>Save date</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setChangingDate(false); setNoticeError(""); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLeaveDate(stay.expected_end_date?.slice(0, 10) ?? "");
                  setNoticeError("");
                  setChangingDate(true);
                }}
              >
                {stay.expected_end_date ? "Change date" : "Add a date"}
              </Button>
              <Button variant="ghost" size="sm" onClick={withdrawNotice}>
                Withdraw notice
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Payment history */}
      <div className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Payments
        </p>
        {stay.payments.length === 0 ? (
          <EmptyState compact message="None yet." />
        ) : (
          <div className="space-y-2">
            {stay.payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </div>

      {/* Actions. Payments the owner records show above as Confirmed; this is
          for a tenant to put one on record themselves, cash or UPI. */}
      {isActive && (
        <div className="border-t border-stone-100 px-5 py-4 space-y-3">
          {!showPaymentForm ? (
            <Button onClick={openPaymentForm}>Record a payment</Button>
          ) : (
            <form onSubmit={handleSubmitPayment} className="space-y-3">
              {paymentError && <FormError>{paymentError}</FormError>}
              {/* Not a Field: its <label> would name the first button "Paid by". */}
              <div>
                <p className="mb-1 text-[13px] font-medium text-stone-600">Paid by</p>
                <SegmentedControl options={PAY_METHODS} value={method} onChange={setMethod} ariaLabel="Paid by" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  required
                  type="number"
                  min="1"
                  inputMode="decimal"
                  placeholder="Amount (₹)"
                  aria-label="Amount in rupees"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-36"
                />
                <Input
                  type="text"
                  placeholder={method === "cash" ? "Who you gave it to" : "UTR or note"}
                  aria-label="Note"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-w-0 flex-1"
                />
              </div>
              {method === "online" && (
                <Field label="Screenshot">
                  <FileInput
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                  />
                </Field>
              )}
              {method === "online" && screenshot && <p className="-mt-2 text-xs text-stone-400">{screenshot.name}</p>}
              <div className="flex gap-2">
                <Button type="submit" loading={paymentLoading}>
                  {paymentLoading ? "Sending…" : "Send"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closePaymentForm}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-stone-400">It counts once the owner confirms it.</p>
            </form>
          )}

          {/* Give notice */}
          {!hasNotice && !noticeOpen && (
            <Button variant="ghost" className="text-red-600! hover:text-red-700!" onClick={() => setNoticeOpen(true)}>
              Give notice to vacate →
            </Button>
          )}

          {!hasNotice && noticeOpen && (
            <form onSubmit={submitNotice} className="rounded-xl bg-stone-50 p-4">
              <h4 className="mb-1 text-sm font-semibold text-stone-800">Notice to vacate</h4>
              <p className="mb-3 text-xs text-stone-500">
                Your owner will be notified. Your stay stays open and rent keeps
                running until they confirm you have moved out.
              </p>

              <Field label="When are you leaving?">
                <Input
                  type="date"
                  value={leaveDate}
                  min={today()}
                  onChange={(e) => setLeaveDate(e.target.value)}
                />
                <p className="mt-1 text-xs text-stone-400">
                  Leave blank if you are not sure yet.
                </p>
              </Field>

              {noticeError && <FormError>{noticeError}</FormError>}

              <div className="mt-3 flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={noticeLoading}>
                  {noticeLoading ? "Submitting…" : "Submit notice"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setNoticeOpen(false); setNoticeError(""); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm font-medium text-stone-900">{formatCurrency(payment.amount)}</span>
        {/* A deposit is held, not rent — the tenant should see it filed as
            what it is, since it comes back to them at move-out. */}
        {payment.kind === "deposit" && <Badge tone="info" className="ml-2">Deposit</Badge>}
        {payment.notes && (
          <span className="ml-2 text-xs text-stone-500">{payment.notes}</span>
        )}
        <RejectionReason payment={payment} className="mt-0.5" />
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right">
        <span className="whitespace-nowrap text-xs text-stone-400">
          {new Date(payment.payment_date).toLocaleDateString("en-IN", {
            day: "numeric", month: "short",
          })}
          {payMethodLabel(payment.payment_type) && ` · ${payMethodLabel(payment.payment_type)}`}
        </span>
        <PaymentStatus payment={payment} audience="tenant" />
      </div>
    </div>
  );
}
