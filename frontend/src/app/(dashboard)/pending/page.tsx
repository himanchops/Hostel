"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import {
  tenantsApi,
  sitesApi,
  gridApi,
  pendingPaymentsApi,
  Tenant,
  Site,
  GridRoom,
  GridBed,
  PendingPayment,
  ApiError,
  today,
  formatCurrency,
} from "@/lib/api";

interface ApproveModalProps {
  tenant: Tenant;
  token: string;
  onDone: (approved: Tenant) => void;
  onClose: () => void;
}

function ApproveModal({ tenant, token, onDone, onClose }: ApproveModalProps) {
  const [assignBed, setAssignBed] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "">("");
  const [rooms, setRooms] = useState<GridRoom[]>([]);
  const [selectedBed, setSelectedBed] = useState<GridBed | null>(null);
  const [rentAmount, setRentAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [rentCycle, setRentCycle] = useState("monthly");
  const [rentDueDay, setRentDueDay] = useState("1");
  const [startDate, setStartDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sitesLoading, setSitesLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);

  useEffect(() => {
    if (!assignBed) return;
    setSitesLoading(true);
    sitesApi.list(token).then(setSites).finally(() => setSitesLoading(false));
  }, [assignBed, token]);

  useEffect(() => {
    if (!siteId) { setRooms([]); setSelectedBed(null); return; }
    setRoomsLoading(true);
    setSelectedBed(null);
    gridApi.get(token, siteId as number).then(setRooms).finally(() => setRoomsLoading(false));
  }, [siteId, token]);

  const vacantBeds = rooms.flatMap((r) =>
    r.beds.filter((b) => b.status === "vacant").map((b) => ({ ...b, roomName: r.name }))
  );

  async function handleApprove() {
    setError("");
    setLoading(true);
    try {
      const payload: Parameters<typeof tenantsApi.approve>[2] = {};
      if (assignBed && selectedBed) {
        if (!rentAmount || !startDate) {
          setError("Rent amount and start date are required for bed assignment.");
          setLoading(false);
          return;
        }
        payload.bed_id = selectedBed.id;
        payload.rent_amount = Math.round(parseFloat(rentAmount) * 100);
        payload.deposit_amount = Math.round(parseFloat(depositAmount || "0") * 100);
        payload.rent_cycle = rentCycle;
        payload.rent_due_day = parseInt(rentDueDay, 10) || 1;
        payload.start_date = startDate;
      }
      const approved = await tenantsApi.approve(token, tenant.id, payload);
      onDone(approved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Approve registration</h2>
        </div>

        <div className="p-6 space-y-5">
          {/* Tenant info */}
          <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1">
            <p className="font-medium text-gray-900">{tenant.name}</p>
            <p className="text-sm text-gray-500">{tenant.phone}{tenant.email ? ` · ${tenant.email}` : ""}</p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* Assign bed toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={assignBed}
              onChange={(e) => setAssignBed(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-700">Assign to a bed now</span>
          </label>

          {assignBed && (
            <div className="space-y-4 rounded-xl border border-gray-200 p-4">
              {/* Site */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Site</label>
                {sitesLoading ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : (
                  <select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value ? parseInt(e.target.value) : "")}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                  >
                    <option value="">Select a site…</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Bed */}
              {siteId && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Bed</label>
                  {roomsLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                  ) : vacantBeds.length === 0 ? (
                    <p className="text-sm text-gray-400">No vacant beds at this site.</p>
                  ) : (
                    <select
                      value={selectedBed?.id ?? ""}
                      onChange={(e) => {
                        const bed = vacantBeds.find((b) => b.id === parseInt(e.target.value));
                        setSelectedBed(bed ?? null);
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    >
                      <option value="">Select a bed…</option>
                      {vacantBeds.map((b) => (
                        <option key={b.id} value={b.id}>{b.roomName} — {b.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Rent details */}
              {selectedBed && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Rent (₹) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 5000"
                      value={rentAmount}
                      onChange={(e) => setRentAmount(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">Deposit (₹)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 10000"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">Rent cycle</label>
                    <select
                      value={rentCycle}
                      onChange={(e) => setRentCycle(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">Due day</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={rentDueDay}
                      onChange={(e) => setRentDueDay(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Move-in date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={loading || (assignBed && (!siteId || !selectedBed))}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:opacity-60"
          >
            {loading ? "Approving…" : assignBed && selectedBed ? "Approve & assign" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PendingPage() {
  const { token, owner } = useAuth();
  const [tab, setTab] = useState<"registrations" | "payments">("registrations");

  // Registrations state
  const [pending, setPending] = useState<Tenant[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [approvingTenant, setApprovingTenant] = useState<Tenant | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  // Payments state
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [payLoading, setPayLoading] = useState(true);
  const [actioningPayId, setActioningPayId] = useState<number | null>(null);

  const registrationUrl = typeof window !== "undefined"
    ? `${window.location.origin}/register/${owner?.id}`
    : "";

  const loadRegistrations = useCallback(() => {
    if (!token) return;
    tenantsApi.list(token, true).then(setPending).finally(() => setRegLoading(false));
  }, [token]);

  const loadPayments = useCallback(() => {
    if (!token) return;
    pendingPaymentsApi.list(token).then(setPendingPayments).finally(() => setPayLoading(false));
  }, [token]);

  useEffect(() => { loadRegistrations(); loadPayments(); }, [loadRegistrations, loadPayments]);

  async function handleReject(id: number) {
    if (!token || !confirm("Remove this registration request?")) return;
    setRejectingId(id);
    try {
      await tenantsApi.reject(token, id);
      setPending((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // ignore
    } finally {
      setRejectingId(null);
    }
  }

  function handleApproved(approved: Tenant) {
    setPending((prev) => prev.filter((t) => t.id !== approved.id));
    setApprovingTenant(null);
  }

  async function handleApprovePayment(id: number) {
    if (!token) return;
    setActioningPayId(id);
    try {
      await pendingPaymentsApi.approve(token, id);
      setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    } finally {
      setActioningPayId(null);
    }
  }

  async function handleRejectPayment(id: number) {
    if (!token || !confirm("Reject and delete this payment submission?")) return;
    setActioningPayId(id);
    try {
      await pendingPaymentsApi.reject(token, id);
      setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    } finally {
      setActioningPayId(null);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pending</h1>
        <p className="mt-1 text-sm text-gray-500">Review registrations and payment submissions.</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl bg-gray-100 p-1 w-fit">
        {(["registrations", "payments"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "registrations" ? "Registrations" : "Payment Proofs"}
            {t === "registrations" && pending.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{pending.length}</span>
            )}
            {t === "payments" && pendingPayments.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{pendingPayments.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "registrations" && (
        <>
          {/* Registration link */}
          <div className="mb-6 rounded-xl bg-indigo-50 px-5 py-4 ring-1 ring-indigo-100">
            <p className="mb-1.5 text-sm font-medium text-indigo-900">Tenant registration link</p>
            <p className="mb-3 text-xs text-indigo-600">Share this link (or a QR code pointing to it) with prospective tenants.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-gray-700 ring-1 ring-indigo-200">
                {registrationUrl}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(registrationUrl)}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
              >
                Copy
              </button>
            </div>
          </div>

          {regLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              Loading…
            </div>
          ) : pending.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-500">No pending registrations.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-200"
                >
                  <div>
                    <p className="font-medium text-gray-900">{t.name}</p>
                    <p className="text-sm text-gray-500">{t.phone}{t.email ? ` · ${t.email}` : ""}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Registered {new Date(t.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                    {t.id_proof_url && (
                      <a
                        href={t.id_proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        View ID proof →
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReject(t.id)}
                      disabled={rejectingId === t.id}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => setApprovingTenant(t)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-green-500"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "payments" && (
        <>
          {payLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              Loading…
            </div>
          ) : pendingPayments.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-500">No pending payment submissions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-200"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {p.tenant_name} · {formatCurrency(p.amount)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {p.site_name} · {p.room_name} · {p.bed_name}
                    </p>
                    {p.notes && <p className="mt-0.5 text-xs text-gray-400">"{p.notes}"</p>}
                    <p className="mt-0.5 text-xs text-gray-400">
                      Submitted {new Date(p.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                    {p.proof_url && (
                      <a
                        href={p.proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        View screenshot →
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRejectPayment(p.id)}
                      disabled={actioningPayId === p.id}
                      className="rounded-lg px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprovePayment(p.id)}
                      disabled={actioningPayId === p.id}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-green-500 disabled:opacity-60"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {approvingTenant && token && (
        <ApproveModal
          tenant={approvingTenant}
          token={token}
          onDone={handleApproved}
          onClose={() => setApprovingTenant(null)}
        />
      )}
    </div>
  );
}
