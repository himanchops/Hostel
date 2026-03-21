"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTenantAuth } from "@/contexts/tenantAuth";
import {
  tenantPortalApi,
  TenantStay,
  Payment,
  ApiError,
  formatCurrency,
  today,
} from "@/lib/api";

export default function TenantPortalPage() {
  const { token, isAuthenticated, isLoading } = useTenantAuth();
  const router = useRouter();
  const [stays, setStays] = useState<TenantStay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/my/login");
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    tenantPortalApi.stays(token).then(setStays).finally(() => setLoading(false));
  }, [token]);

  if (isLoading || loading) {
    return (
      <div className="flex items-center gap-2 pt-8 text-sm text-gray-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        Loading…
      </div>
    );
  }

  if (stays.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
        <p className="text-sm text-gray-500">No stays found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {stays.map((stay) => (
        <StayCard key={stay.id} stay={stay} token={token!} onUpdate={(updated) => {
          setStays((prev) => prev.map((s) => s.id === updated.id ? updated : s));
        }} />
      ))}
    </div>
  );
}

function StayCard({ stay, token, onUpdate }: {
  stay: TenantStay;
  token: string;
  onUpdate: (updated: TenantStay) => void;
}) {
  const isActive = !stay.end_date;
  const hasNotice = !!stay.notice_date;

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [noticeLoading, setNoticeLoading] = useState(false);

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setPaymentError("");
    setPaymentLoading(true);
    try {
      const payment = await tenantPortalApi.submitPayment(token, stay.id, {
        amount: Math.round(parseFloat(amount) * 100),
        notes: notes || undefined,
      });
      onUpdate({ ...stay, payments: [payment, ...stay.payments] });
      setAmount("");
      setNotes("");
      setShowPaymentForm(false);
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handleGiveNotice() {
    if (!confirm("Submit notice to vacate? This will notify your owner.")) return;
    setNoticeLoading(true);
    try {
      const updated = await tenantPortalApi.submitNotice(token, stay.id);
      onUpdate({ ...stay, notice_date: updated.notice_date as string | undefined });
    } catch {
      // ignore
    } finally {
      setNoticeLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 overflow-hidden">
      {/* Stay header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">
              {stay.site_name} · {stay.room_name} · {stay.bed_name}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              {formatCurrency(stay.rent_amount)}/{stay.rent_cycle} · Since{" "}
              {new Date(stay.start_date).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric",
              })}
              {stay.end_date && (
                <> · Ended {new Date(stay.end_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>
              )}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {isActive ? (hasNotice ? "Notice given" : "Active") : "Ended"}
          </span>
        </div>

        {stay.notice_date && (
          <p className="mt-2 text-xs text-amber-600">
            Notice given on {new Date(stay.notice_date).toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
        )}
      </div>

      {/* Payment history */}
      <div className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Payment history
        </p>
        {stay.payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <div className="space-y-2">
            {stay.payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {isActive && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-3">
          {/* Submit payment */}
          {!showPaymentForm ? (
            <button
              onClick={() => setShowPaymentForm(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Submit payment
            </button>
          ) : (
            <form onSubmit={handleSubmitPayment} className="space-y-3">
              {paymentError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{paymentError}</div>
              )}
              <div className="flex gap-2">
                <input
                  required
                  type="number"
                  min="1"
                  placeholder="Amount (₹)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
                <input
                  type="text"
                  placeholder="Notes / UTR / reference (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={paymentLoading}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  {paymentLoading ? "Submitting…" : "Submit"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPaymentForm(false); setPaymentError(""); }}
                  className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-400">Your payment will be visible once the owner approves it.</p>
            </form>
          )}

          {/* Give notice */}
          {!hasNotice && (
            <button
              onClick={handleGiveNotice}
              disabled={noticeLoading}
              className="block text-sm text-red-500 hover:text-red-700 disabled:opacity-60"
            >
              {noticeLoading ? "Submitting…" : "Give notice to vacate →"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <div>
        <span className="text-sm font-medium text-gray-900">{formatCurrency(payment.amount)}</span>
        {payment.notes && (
          <span className="ml-2 text-xs text-gray-500">{payment.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-right">
        <span className="text-xs text-gray-400">
          {new Date(payment.payment_date).toLocaleDateString("en-IN", {
            day: "numeric", month: "short",
          })}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          payment.is_approved
            ? "bg-green-100 text-green-700"
            : "bg-amber-100 text-amber-700"
        }`}>
          {payment.is_approved ? "Confirmed" : "Pending"}
        </span>
      </div>
    </div>
  );
}
