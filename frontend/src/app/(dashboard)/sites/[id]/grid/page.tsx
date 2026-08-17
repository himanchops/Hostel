"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  gridApi, sitesApi, tenantsApi, staysApi, paymentsApi,
  GridRoom, GridBed, BedStatus, Site, Tenant, Payment,
  formatCurrency, today,
  ApiError,
} from "@/lib/api";

// ─── Status config ────────────────────────────────────────────────────────────

// Colors come from the status tokens in globals.css — never raw green-/red-/etc.
// Classes are written out in full (not interpolated) so Tailwind's scanner sees them.
const STATUS: Record<BedStatus, { bg: string; border: string; text: string; label: string }> = {
  vacant:       { bg: "bg-vacant-100",   border: "border-vacant-200",   text: "text-vacant-500",   label: "Vacant" },
  paid:         { bg: "bg-paid-100",     border: "border-paid-200",     text: "text-paid-800",     label: "Paid" },
  partial:      { bg: "bg-partial-100",  border: "border-partial-200",  text: "text-partial-800",  label: "Partial" },
  overdue:      { bg: "bg-overdue-100",  border: "border-overdue-200",  text: "text-overdue-800",  label: "Overdue" },
  vacating_soon:{ bg: "bg-vacating-100", border: "border-vacating-200", text: "text-vacating-800", label: "Vacating" },
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GridPage() {
  const { id } = useParams<{ id: string }>();
  const siteId = Number(id);
  const { token } = useAuth();
  const router = useRouter();

  const [site, setSite] = useState<Site | null>(null);
  const [grid, setGrid] = useState<GridRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // Panel state
  const [selectedBed, setSelectedBed] = useState<GridBed | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const fetchGrid = useCallback(() => {
    if (!token) return;
    return gridApi.get(token, siteId).then(setGrid).catch(() => {});
  }, [token, siteId]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      sitesApi.get(token, siteId),
      gridApi.get(token, siteId),
    ])
      .then(([s, g]) => { setSite(s); setGrid(g); })
      .catch(() => router.replace("/sites"))
      .finally(() => setLoading(false));
  }, [token, siteId, router]);

  function handleBedClick(bed: GridBed) {
    setSelectedBed(bed);
    setShowAssign(bed.status === "vacant");
    setShowPayment(false);
  }

  async function handleAssigned() {
    setShowAssign(false);
    setSelectedBed(null);
    await fetchGrid();
  }

  async function handlePaymentAdded() {
    setShowPayment(false);
    setSelectedBed(null);
    await fetchGrid();
  }

  async function handleVacate(stayId: number) {
    if (!token || !confirm("Mark this tenant as vacated today?")) return;
    await staysApi.update(token, stayId, { end_date: today() });
    setSelectedBed(null);
    await fetchGrid();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main grid area */}
      <div className="flex-1 overflow-auto p-8">
        {/* Breadcrumb + header */}
        <div className="mb-2 flex items-center gap-2 text-sm text-stone-500">
          <Link href="/sites" className="hover:text-indigo-600">Sites</Link>
          <span>/</span>
          <Link href={`/sites/${siteId}`} className="hover:text-indigo-600">{site?.name}</Link>
          <span>/</span>
          <span className="text-stone-800">Grid</span>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-stone-900">{site?.name} — Occupancy Grid</h1>
          <Link
            href={`/sites/${siteId}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Manage rooms
          </Link>
        </div>

        {/* Legend */}
        <div className="mb-6 flex flex-wrap gap-3">
          {(Object.entries(STATUS) as [BedStatus, typeof STATUS[BedStatus]][]).map(([key, cfg]) => (
            <div key={key} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}>
              <span className={`h-2 w-2 rounded-full ${cfg.bg} border ${cfg.border} ring-1 ring-current`} />
              {cfg.label}
            </div>
          ))}
        </div>

        {/* Grid */}
        {grid.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-stone-200 py-20 text-center">
            <p className="text-sm text-stone-400">No rooms found. Add rooms and beds first.</p>
            <Link href={`/sites/${siteId}`} className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-500">
              Manage rooms →
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {grid.map((room) => (
              <div key={room.id}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-stone-700">{room.name}</h2>
                  {room.floor > 0 && (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                      Floor {room.floor}
                    </span>
                  )}
                </div>

                {room.beds.length === 0 ? (
                  <p className="text-xs text-stone-400">No beds — add beds to this room.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {room.beds.map((bed) => (
                      <BedCard
                        key={bed.id}
                        bed={bed}
                        selected={selectedBed?.id === bed.id}
                        onClick={() => handleBedClick(bed)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Side panel */}
      {selectedBed && (
        <div className="w-80 shrink-0 border-l border-stone-200 bg-white p-6 shadow-sm">
          {showAssign ? (
            <AssignPanel
              token={token!}
              bed={selectedBed}
              siteId={siteId}
              onDone={handleAssigned}
              onCancel={() => { setSelectedBed(null); setShowAssign(false); }}
            />
          ) : (
            <OccupiedPanel
              token={token!}
              bed={selectedBed}
              showPaymentForm={showPayment}
              onShowPayment={() => setShowPayment(true)}
              onPaymentAdded={handlePaymentAdded}
              onVacate={handleVacate}
              onClose={() => setSelectedBed(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bed card ─────────────────────────────────────────────────────────────────

function BedCard({ bed, selected, onClick }: { bed: GridBed; selected: boolean; onClick: () => void }) {
  const cfg = STATUS[bed.status];
  return (
    <button
      onClick={onClick}
      className={`w-36 rounded-xl border-2 p-3 text-left transition-all ${cfg.bg} ${cfg.border} ${cfg.text}
        ${selected ? "ring-2 ring-indigo-400 ring-offset-1" : "hover:brightness-95"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-60">{cfg.label}</p>
      <p className="mt-0.5 text-base font-bold">{bed.name}</p>
      {bed.tenant ? (
        <>
          <p className="mt-1 truncate text-xs font-medium">{bed.tenant.name}</p>
          {bed.balance !== undefined && bed.balance < 0 && (
            <p className="mt-0.5 text-xs opacity-75">Owes {formatCurrency(Math.abs(bed.balance))}</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs opacity-50">Tap to assign</p>
      )}
    </button>
  );
}

// ─── Assign panel ─────────────────────────────────────────────────────────────

function AssignPanel({
  token, bed, siteId, onDone, onCancel,
}: {
  token: string; bed: GridBed; siteId: number;
  onDone: () => void; onCancel: () => void;
}) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // New tenant fields
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Stay fields
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [rent, setRent] = useState("");         // in rupees
  const [deposit, setDeposit] = useState("0");  // in rupees
  const [cycle, setCycle] = useState("monthly");
  const [startDate, setStartDate] = useState(today());
  const [step, setStep] = useState<"select" | "stay">("select");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    tenantsApi.list(token).then(setTenants).catch(() => {});
  }, [token]);

  const filtered = tenants.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.phone.includes(search)
  );

  async function handleCreateTenant() {
    if (!newName || !newPhone) { setError("Name and phone required"); return; }
    setLoading(true);
    try {
      const t = await tenantsApi.create(token, { name: newName, phone: newPhone, email: newEmail || undefined });
      setTenants((prev) => [...prev, t]);
      setTenantId(t.id);
      setStep("stay");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign() {
    if (!tenantId || !rent) { setError("All fields required"); return; }
    setLoading(true);
    try {
      await staysApi.create(token, {
        tenant_id: tenantId,
        bed_id: bed.id,
        rent_amount: Math.round(parseFloat(rent) * 100),
        deposit_amount: Math.round(parseFloat(deposit || "0") * 100),
        rent_cycle: cycle,
        rent_due_day: new Date(startDate).getDate(),
        start_date: startDate,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to assign");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-stone-900">Assign to {bed.name}</h3>
        <button onClick={onCancel} className="text-stone-400 hover:text-stone-600">✕</button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === "select" ? (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Search tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />

          <div className="max-h-48 overflow-y-auto space-y-1">
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTenantId(t.id); setStep("stay"); setError(""); }}
                className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition hover:bg-indigo-50"
              >
                <span className="text-sm font-medium text-stone-800">{t.name}</span>
                <span className="text-xs text-stone-500">{t.phone}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-2 text-center text-xs text-stone-400">No tenants found</p>
            )}
          </div>

          <div className="border-t border-stone-100 pt-3">
            {!creating ? (
              <button
                onClick={() => setCreating(true)}
                className="w-full rounded-lg bg-stone-100 px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-200"
              >
                + New tenant
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  placeholder="Name *"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <input
                  placeholder="Phone *"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <input
                  placeholder="Email (optional)"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateTenant}
                    disabled={loading}
                    className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {loading ? "…" : "Create"}
                  </button>
                  <button
                    onClick={() => setCreating(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            Tenant: <strong>{tenants.find((t) => t.id === tenantId)?.name}</strong>
          </p>

          <div>
            <label className="block text-xs font-medium text-stone-600">Monthly rent (₹)</label>
            <input
              type="number"
              placeholder="e.g. 8000"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600">Deposit (₹)</label>
            <input
              type="number"
              placeholder="e.g. 16000"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600">Billing cycle</label>
            <select
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAssign}
              disabled={loading}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {loading ? "Assigning…" : "Assign"}
            </button>
            <button
              onClick={() => { setStep("select"); setError(""); }}
              className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Occupied panel ───────────────────────────────────────────────────────────

function OccupiedPanel({
  token, bed, showPaymentForm, onShowPayment, onPaymentAdded, onVacate, onClose,
}: {
  token: string;
  bed: GridBed;
  showPaymentForm: boolean;
  onShowPayment: () => void;
  onPaymentAdded: () => void;
  onVacate: (stayId: number) => void;
  onClose: () => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  // Payment form
  const [amount, setAmount] = useState("");
  const [payType, setPayType] = useState("cash");
  const [payDate, setPayDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [payError, setPayError] = useState("");
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (!bed.stay_id) return;
    staysApi.payments(token, bed.stay_id)
      .then(setPayments)
      .catch(() => {})
      .finally(() => setPaymentsLoading(false));
  }, [token, bed.stay_id]);

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!bed.stay_id || !amount) return;
    setPayError("");
    setPayLoading(true);
    try {
      await staysApi.addPayment(token, bed.stay_id, {
        amount: Math.round(parseFloat(amount) * 100),
        payment_type: payType,
        payment_date: payDate,
        notes: notes || undefined,
      });
      onPaymentAdded();
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setPayLoading(false);
    }
  }

  async function handleDeletePayment(id: number) {
    if (!confirm("Delete this payment?")) return;
    await paymentsApi.delete(token, id);
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  const cfg = STATUS[bed.status];
  const balance = bed.balance ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-stone-900">Bed {bed.name}</h3>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600">✕</button>
      </div>

      {/* Status badge */}
      <div className={`mb-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cfg.bg} ${cfg.border} ${cfg.text}`}>
        {cfg.label}
      </div>

      {bed.tenant && (
        <div className="mb-4">
          <p className="text-lg font-bold text-stone-900">{bed.tenant.name}</p>
          <p className="text-sm text-stone-500">{bed.tenant.phone}</p>
          {bed.tenant.id && (
            <Link
              href={`/tenants/${bed.tenant.id}`}
              className="mt-1 inline-block text-xs text-indigo-600 hover:text-indigo-500"
            >
              View profile →
            </Link>
          )}
        </div>
      )}

      {/* Balance */}
      <div className={`mb-4 rounded-xl p-4 ${balance >= 0 ? "bg-green-50" : "bg-red-50"}`}>
        <p className="text-xs font-medium text-stone-500">Balance</p>
        <p className={`text-2xl font-bold ${balance >= 0 ? "text-green-700" : "text-red-700"}`}>
          {balance >= 0 ? "+" : ""}{formatCurrency(balance)}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          Paid {formatCurrency(bed.total_paid ?? 0)} of {formatCurrency(bed.total_expected ?? 0)} expected
        </p>
        {bed.rent_amount && (
          <p className="mt-0.5 text-xs text-stone-400">
            Rent: {formatCurrency(bed.rent_amount)}/{bed.stay_id ? "mo" : ""}
            {bed.deposit_amount ? ` · Deposit: ${formatCurrency(bed.deposit_amount)}` : ""}
          </p>
        )}
      </div>

      {/* Actions */}
      {!showPaymentForm ? (
        <div className="mb-4 flex gap-2">
          <button
            onClick={onShowPayment}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            + Add payment
          </button>
          {bed.stay_id && (
            <button
              onClick={() => onVacate(bed.stay_id!)}
              className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-500 transition hover:bg-stone-50"
              title="Mark as vacated today"
            >
              Vacate
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={handleAddPayment} className="mb-4 rounded-xl bg-stone-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-stone-800">Add payment</h4>
          {payError && <p className="mb-2 text-xs text-red-600">{payError}</p>}
          <div className="space-y-2">
            <input
              required
              type="number"
              placeholder="Amount (₹)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
            <select
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            >
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
            <input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
            <input
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={payLoading}
              className="w-full rounded-lg bg-indigo-600 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {payLoading ? "Saving…" : "Save payment"}
            </button>
          </div>
        </form>
      )}

      {/* Payment history */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Payment history</h4>
        {paymentsLoading ? (
          <p className="text-xs text-stone-400">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-stone-400">No payments yet.</p>
        ) : (
          <div className="space-y-1.5">
            {payments.map((p) => (
              <div key={p.id} className="group flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-stone-800">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-stone-400">
                    {p.payment_type} · {p.payment_date.slice(0, 10)}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleDeletePayment(p.id)}
                  className="hidden text-stone-300 transition hover:text-red-500 group-hover:block"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
