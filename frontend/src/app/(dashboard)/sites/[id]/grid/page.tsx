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
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  STATUS_STYLES,
  Select,
  Skeleton,
  StatusPill,
  useConfirm,
} from "@/components/ui";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GridPage() {
  const { id } = useParams<{ id: string }>();
  const siteId = Number(id);
  const { token } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();

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

  function closePanel() {
    setSelectedBed(null);
    setShowAssign(false);
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
    if (!token) return;
    const ok = await confirm({
      title: "Mark this tenant as vacated today?",
      message: "The stay will be ended with today's date.",
      confirmLabel: "Vacate",
      tone: "danger",
    });
    if (!ok) return;
    await staysApi.update(token, stayId, { end_date: today() });
    setSelectedBed(null);
    await fetchGrid();
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-8 w-96" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-36" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 lg:p-8">
      <PageHeader
        breadcrumb={[
          { label: "Sites", href: "/sites" },
          { label: site?.name ?? "", href: `/sites/${siteId}` },
          { label: "Grid" },
        ]}
        title={`${site?.name ?? ""} — Occupancy Grid`}
        actions={
          <Link
            href={`/sites/${siteId}`}
            className="text-sm text-indigo-600 transition duration-150 ease-out hover:text-indigo-500"
          >
            ← Manage rooms
          </Link>
        }
      />

      {/* Legend */}
      <div className="mb-6 flex flex-wrap gap-3">
        {(Object.keys(STATUS_STYLES) as BedStatus[]).map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </div>

      {/* Grid */}
      {grid.length === 0 ? (
        <EmptyState
          message="No rooms found. Add rooms and beds first."
          action={
            <Link href={`/sites/${siteId}`} className="text-sm text-indigo-600 hover:text-indigo-500">
              Manage rooms →
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {grid.map((room) => (
            <div key={room.id}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-stone-700">{room.name}</h2>
                {room.floor > 0 && <Badge tone="neutral">Floor {room.floor}</Badge>}
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

      {/* Side panel */}
      <Drawer
        open={selectedBed !== null}
        onClose={closePanel}
        title={selectedBed ? (showAssign ? `Assign to ${selectedBed.name}` : `Bed ${selectedBed.name}`) : ""}
      >
        {selectedBed && token && (showAssign ? (
          <AssignPanel
            token={token}
            bed={selectedBed}
            onDone={handleAssigned}
            onCancel={closePanel}
          />
        ) : (
          <OccupiedPanel
            token={token}
            bed={selectedBed}
            showPaymentForm={showPayment}
            onShowPayment={() => setShowPayment(true)}
            onPaymentAdded={handlePaymentAdded}
            onVacate={handleVacate}
          />
        ))}
      </Drawer>
    </div>
  );
}

// ─── Bed card ─────────────────────────────────────────────────────────────────

function BedCard({ bed, selected, onClick }: { bed: GridBed; selected: boolean; onClick: () => void }) {
  const cfg = STATUS_STYLES[bed.status];
  return (
    <button
      onClick={onClick}
      className={`w-36 rounded-xl border-2 p-3 text-left transition duration-150 ease-out ${cfg.bg} ${cfg.border} ${cfg.text}
        ${selected ? "ring-2 ring-indigo-400 ring-offset-1" : "hover:brightness-95"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-60">{cfg.label}</p>
      <p className="mt-0.5 text-base font-bold">{bed.name}</p>
      {bed.tenant ? (
        <>
          <p className="mt-1 truncate text-xs font-medium">{bed.tenant.name}</p>
          {bed.balance !== undefined && bed.balance < 0 && (
            <p className="mt-0.5 text-xs tabular-nums opacity-75">
              Owes {formatCurrency(Math.abs(bed.balance))}
            </p>
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
  token, bed, onDone, onCancel,
}: {
  token: string; bed: GridBed;
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
      {error && <div className="mb-3"><FormError>{error}</FormError></div>}

      {step === "select" ? (
        <div className="space-y-3">
          <Input
            type="text"
            placeholder="Search tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTenantId(t.id); setStep("stay"); setError(""); }}
                className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition duration-150 ease-out hover:bg-indigo-50"
              >
                <span className="text-sm font-medium text-stone-800">{t.name}</span>
                <span className="text-xs tabular-nums text-stone-500">{t.phone}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-2 text-center text-xs text-stone-400">No tenants found</p>
            )}
          </div>

          <div className="border-t border-stone-100 pt-3">
            {!creating ? (
              <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
                + New tenant
              </Button>
            ) : (
              <div className="space-y-2">
                <Input placeholder="Name *" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input placeholder="Phone *" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                <Input placeholder="Email (optional)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <div className="flex gap-2">
                  <Button className="flex-1" loading={loading} onClick={handleCreateTenant}>
                    {loading ? "…" : "Create"}
                  </Button>
                  <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-stone-100 pt-3">
            <Button variant="ghost" className="w-full" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            Tenant: <strong>{tenants.find((t) => t.id === tenantId)?.name}</strong>
          </p>

          <Field label="Monthly rent (₹)">
            <Input type="number" placeholder="e.g. 8000" value={rent} onChange={(e) => setRent(e.target.value)} />
          </Field>
          <Field label="Deposit (₹)">
            <Input type="number" placeholder="e.g. 16000" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
          <Field label="Billing cycle">
            <Select value={cycle} onChange={(e) => setCycle(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>

          <div className="flex gap-2 pt-1">
            <Button className="flex-1" loading={loading} onClick={handleAssign}>
              {loading ? "Assigning…" : "Assign"}
            </Button>
            <Button variant="ghost" onClick={() => { setStep("select"); setError(""); }}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Occupied panel ───────────────────────────────────────────────────────────

function OccupiedPanel({
  token, bed, showPaymentForm, onShowPayment, onPaymentAdded, onVacate,
}: {
  token: string;
  bed: GridBed;
  showPaymentForm: boolean;
  onShowPayment: () => void;
  onPaymentAdded: () => void;
  onVacate: (stayId: number) => void;
}) {
  const confirm = useConfirm();
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
    const ok = await confirm({ title: "Delete this payment?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    await paymentsApi.delete(token, id);
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  const balance = bed.balance ?? 0;
  const settled = balance >= 0;

  return (
    <div>
      <div className="mb-4">
        <StatusPill status={bed.status} />
      </div>

      {bed.tenant && (
        <div className="mb-4">
          <p className="text-lg font-bold text-stone-900">{bed.tenant.name}</p>
          <p className="text-sm tabular-nums text-stone-500">{bed.tenant.phone}</p>
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
      <div className={`mb-4 rounded-xl p-4 ${settled ? "bg-paid-50" : "bg-overdue-50"}`}>
        <p className="text-xs font-medium text-stone-500">Balance</p>
        <p className={`text-2xl font-bold tabular-nums ${settled ? "text-paid-800" : "text-overdue-800"}`}>
          {settled ? "+" : ""}{formatCurrency(balance)}
        </p>
        <p className="mt-1 text-xs tabular-nums text-stone-400">
          Paid {formatCurrency(bed.total_paid ?? 0)} of {formatCurrency(bed.total_expected ?? 0)} expected
        </p>
        {bed.rent_amount && (
          <p className="mt-0.5 text-xs tabular-nums text-stone-400">
            Rent: {formatCurrency(bed.rent_amount)}/{bed.stay_id ? "mo" : ""}
            {bed.deposit_amount ? ` · Deposit: ${formatCurrency(bed.deposit_amount)}` : ""}
          </p>
        )}
      </div>

      {/* Actions */}
      {!showPaymentForm ? (
        <div className="mb-4 flex gap-2">
          <Button className="flex-1" onClick={onShowPayment}>+ Add payment</Button>
          {bed.stay_id && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onVacate(bed.stay_id!)}
              title="Mark as vacated today"
            >
              Vacate
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={handleAddPayment} className="mb-4 rounded-xl bg-stone-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-stone-800">Add payment</h4>
          {payError && <p className="mb-2 text-xs text-red-600">{payError}</p>}
          <div className="space-y-2">
            <Input
              required
              type="number"
              placeholder="Amount (₹)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select value={payType} onChange={(e) => setPayType(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </Select>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button type="submit" className="w-full" loading={payLoading}>
              {payLoading ? "Saving…" : "Save payment"}
            </Button>
          </div>
        </form>
      )}

      {/* Payment history */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Payment history</h4>
        {paymentsLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <p className="text-xs text-stone-400">No payments yet.</p>
        ) : (
          <div className="space-y-1.5">
            {payments.map((p) => (
              <div key={p.id} className="group flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium tabular-nums text-stone-800">{formatCurrency(p.amount)}</p>
                  <p className="text-xs tabular-nums text-stone-400">
                    {p.payment_type} · {p.payment_date.slice(0, 10)}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleDeletePayment(p.id)}
                  className="hidden text-stone-300 transition duration-150 ease-out hover:text-red-500 group-hover:block"
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
