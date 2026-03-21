"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, staysApi, paymentsApi, Tenant, Stay, Payment, formatCurrency, today, ApiError } from "@/lib/api";

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = Number(id);
  const { token } = useAuth();
  const router = useRouter();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded stay → payments
  const [payments, setPayments] = useState<Record<number, Payment[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  // Add payment inline
  const [addingPayment, setAddingPayment] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState("cash");
  const [payDate, setPayDate] = useState(today());
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState("");
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    Promise.all([tenantsApi.get(token, tenantId), tenantsApi.stays(token, tenantId)])
      .then(([t, s]) => { setTenant(t); setStays(s); })
      .catch(() => router.replace("/tenants"))
      .finally(() => setLoading(false));
  }, [token, tenantId, router]);

  async function toggleStay(stayId: number) {
    setExpanded(expanded === stayId ? null : stayId);
    if (!payments[stayId] && token) {
      const p = await staysApi.payments(token, stayId).catch(() => []);
      setPayments((prev) => ({ ...prev, [stayId]: p }));
    }
  }

  async function handleAddPayment(e: React.FormEvent, stayId: number) {
    e.preventDefault();
    if (!token) return;
    setPayError("");
    setPayLoading(true);
    try {
      const p = await staysApi.addPayment(token, stayId, {
        amount: Math.round(parseFloat(payAmount) * 100),
        payment_type: payType,
        payment_date: payDate,
        notes: payNotes || undefined,
      });
      setPayments((prev) => ({ ...prev, [stayId]: [p, ...(prev[stayId] || [])] }));
      setPayAmount("");
      setPayNotes("");
      setAddingPayment(null);
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setPayLoading(false);
    }
  }

  async function handleDeletePayment(stayId: number, paymentId: number) {
    if (!token || !confirm("Delete this payment?")) return;
    await paymentsApi.delete(token, paymentId);
    setPayments((prev) => ({ ...prev, [stayId]: prev[stayId].filter((p) => p.id !== paymentId) }));
  }

  async function handleVacate(stayId: number) {
    if (!token || !confirm("Mark stay as ended today?")) return;
    const updated = await staysApi.update(token, stayId, { end_date: today() });
    setStays((prev) => prev.map((s) => (s.id === stayId ? updated : s)));
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/tenants" className="hover:text-indigo-600">Tenants</Link>
        <span>/</span>
        <span className="text-gray-800">{tenant?.name}</span>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-600">
          {tenant?.name[0]?.toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name}</h1>
          <p className="text-sm text-gray-500">{tenant?.phone}</p>
          {tenant?.email && <p className="text-sm text-gray-500">{tenant.email}</p>}
        </div>
      </div>

      {/* Stays */}
      <h2 className="mb-3 text-base font-semibold text-gray-900">Stays & Ledger</h2>

      {stays.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">
          No stays recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => {
            const active = !stay.end_date;
            const stayPayments = payments[stay.id];
            const totalPaid = (stayPayments || []).reduce((s, p) => s + p.amount, 0);

            return (
              <div key={stay.id} className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
                {/* Stay header */}
                <button
                  onClick={() => toggleStay(stay.id)}
                  className="flex w-full items-start justify-between px-5 py-4 text-left"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {active ? "Active" : "Ended"}
                      </span>
                      <span className="text-sm font-medium text-gray-700">
                        Bed #{stay.bed_id}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {stay.start_date.slice(0, 10)}
                      {stay.end_date ? ` → ${stay.end_date.slice(0, 10)}` : " → present"}
                      {" · "}
                      {formatCurrency(stay.rent_amount)}/{stay.rent_cycle}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-700">
                      Paid {formatCurrency(totalPaid)}
                    </p>
                    {active && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleVacate(stay.id); }}
                        className="mt-1 text-xs text-gray-400 hover:text-red-500"
                      >
                        End stay
                      </button>
                    )}
                  </div>
                </button>

                {/* Expanded: payment ledger */}
                {expanded === stay.id && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    {/* Add payment */}
                    {active && (
                      <div className="mb-4">
                        {addingPayment !== stay.id ? (
                          <button
                            onClick={() => setAddingPayment(stay.id)}
                            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                          >
                            + Add payment
                          </button>
                        ) : (
                          <form
                            onSubmit={(e) => handleAddPayment(e, stay.id)}
                            className="flex flex-wrap items-end gap-2"
                          >
                            {payError && <p className="w-full text-xs text-red-600">{payError}</p>}
                            <input
                              required
                              type="number"
                              placeholder="Amount (₹)"
                              value={payAmount}
                              onChange={(e) => setPayAmount(e.target.value)}
                              className="w-32 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            />
                            <select
                              value={payType}
                              onChange={(e) => setPayType(e.target.value)}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            >
                              <option value="cash">Cash</option>
                              <option value="online">Online</option>
                            </select>
                            <input
                              type="date"
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            />
                            <input
                              placeholder="Notes"
                              value={payNotes}
                              onChange={(e) => setPayNotes(e.target.value)}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            />
                            <button
                              type="submit"
                              disabled={payLoading}
                              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              {payLoading ? "…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddingPayment(null)}
                              className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-100"
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Payments list */}
                    {stayPayments === undefined ? (
                      <p className="text-xs text-gray-400">Loading…</p>
                    ) : stayPayments.length === 0 ? (
                      <p className="text-xs text-gray-400">No payments recorded.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                            <th className="pb-2">Date</th>
                            <th className="pb-2">Amount</th>
                            <th className="pb-2">Type</th>
                            <th className="pb-2">Notes</th>
                            <th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {stayPayments.map((p) => (
                            <tr key={p.id} className="group">
                              <td className="py-2 text-gray-600">{p.payment_date.slice(0, 10)}</td>
                              <td className="py-2 font-medium text-gray-800">{formatCurrency(p.amount)}</td>
                              <td className="py-2 capitalize text-gray-500">{p.payment_type}</td>
                              <td className="py-2 text-gray-400">{p.notes || "—"}</td>
                              <td className="py-2 text-right">
                                <button
                                  onClick={() => handleDeletePayment(stay.id, p.id)}
                                  className="hidden text-gray-300 transition hover:text-red-500 group-hover:inline"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
