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
  maskAadhaar,
} from "@/lib/api";
import {
  Button,
  Card,
  CountBadge,
  Drawer,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useConfirm,
} from "@/components/ui";

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-violet-100 text-violet-700",
  "bg-pink-100 text-pink-700",
  "bg-amber-100 text-amber-700",
  "bg-teal-100 text-teal-700",
  "bg-sky-100 text-sky-700",
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, photoUrl, size = "md" }: { name: string; photoUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-16 w-16 text-2xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${dim} ${avatarColor(name)} flex flex-shrink-0 items-center justify-center rounded-full font-bold`}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-base leading-none">{icon}</span>
      <div>
        <p className="text-xs font-medium text-stone-400">{label}</p>
        <p className="text-sm text-stone-700">{value}</p>
      </div>
    </div>
  );
}

function IdProofTile({ label, url, isImage }: { label: string; url: string; isImage: boolean }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="group flex-1">
      {isImage ? (
        <div className="relative aspect-[3/2] overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
          <img src={url} alt={`ID ${label}`} className="h-full w-full object-cover transition duration-150 ease-out group-hover:opacity-80" />
          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/40 to-transparent opacity-0 transition duration-150 ease-out group-hover:opacity-100">
            <span className="px-2 py-1 text-xs font-semibold text-white">Open</span>
          </div>
          <div className="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white">{label}</div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 transition duration-150 ease-out group-hover:bg-stone-100">
          <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
          </svg>
          <span className="text-xs font-medium text-stone-700">ID {label} (PDF)</span>
        </div>
      )}
    </a>
  );
}

function RentFields({ rentCycle, setRentCycle, rentAmount, setRentAmount, depositAmount, setDepositAmount, startDate, setStartDate, rentLabel }: {
  rentCycle: string; setRentCycle: (v: string) => void;
  rentAmount: string; setRentAmount: (v: string) => void;
  depositAmount: string; setDepositAmount: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  rentLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Billing cycle">
        <Select value={rentCycle} onChange={(e) => setRentCycle(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
        </Select>
      </Field>
      <Field label={rentLabel} required>
        <Input type="number" min="0" placeholder="e.g. 5000" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} />
      </Field>
      <Field label="Deposit (₹)">
        <Input type="number" min="0" placeholder="e.g. 10000" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
      </Field>
      <Field label="Start date" required className="col-span-2">
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>
    </div>
  );
}

// ── Unified Review + Approve Drawer ──────────────────────────────────────────

type ApproveMode = "approve_only" | "assign_bed" | "collect_deposit";
type DrawerStep = "review" | "approve";

function ReviewDrawer({
  tenant, token, onDone, onReject, onClose, rejectingId,
}: {
  tenant: Tenant;
  token: string;
  onDone: (approved: Tenant) => void;
  onReject: (id: number) => void;
  onClose: () => void;
  rejectingId: number | null;
}) {
  const [step, setStep] = useState<DrawerStep>("review");

  // Approval state
  const [mode, setMode] = useState<ApproveMode>("approve_only");
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "">("");
  const [rooms, setRooms] = useState<GridRoom[]>([]);
  const [selectedBed, setSelectedBed] = useState<GridBed | null>(null);
  const [rentAmount, setRentAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [rentCycle, setRentCycle] = useState("monthly");
  const [startDate, setStartDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sitesLoading, setSitesLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const rentLabel = rentCycle === "monthly" ? "Monthly rent (₹)" : rentCycle === "weekly" ? "Weekly rent (₹)" : "Daily rent (₹)";

  const idFront = tenant.id_proof_front_url ?? tenant.id_proof_url;
  const idBack = tenant.id_proof_back_url;
  const isImage = (url: string) => /\.(jpe?g|png|webp)(\?|$)/i.test(url);

  useEffect(() => {
    if (mode !== "assign_bed" || step !== "approve") return;
    setSitesLoading(true);
    sitesApi.list(token).then(setSites).finally(() => setSitesLoading(false));
  }, [mode, step, token]);

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

      if (mode === "assign_bed") {
        if (!selectedBed || !rentAmount || !startDate) {
          setError("Select a bed, enter rent amount and start date.");
          setLoading(false);
          return;
        }
        payload.bed_id = selectedBed.id;
        payload.rent_amount = Math.round(parseFloat(rentAmount) * 100);
        payload.deposit_amount = Math.round(parseFloat(depositAmount || "0") * 100);
        payload.rent_cycle = rentCycle;
        payload.start_date = startDate;
      } else if (mode === "collect_deposit") {
        if (!rentAmount) {
          setError("Enter an advance/deposit amount.");
          setLoading(false);
          return;
        }
        payload.rent_amount = Math.round(parseFloat(rentAmount) * 100);
        payload.deposit_amount = Math.round(parseFloat(depositAmount || "0") * 100);
        payload.rent_cycle = rentCycle;
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

  const header = (
    <div className="flex items-center gap-2">
      {step === "approve" && (
        <button
          onClick={() => { setStep("review"); setError(""); }}
          aria-label="Back"
          className="rounded-lg p-1 text-stone-400 transition duration-150 ease-out hover:bg-stone-100 hover:text-stone-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-700">
        {step === "review" ? "Registration details" : "Approve registration"}
      </h2>
    </div>
  );

  const footer =
    step === "review" ? (
      <div className="flex gap-2">
        <Button
          variant="danger"
          className="flex-1"
          loading={rejectingId === tenant.id}
          onClick={() => onReject(tenant.id)}
        >
          {rejectingId === tenant.id ? "Removing…" : "Reject"}
        </Button>
        <Button className="flex-1" onClick={() => setStep("approve")}>
          Approve
        </Button>
      </div>
    ) : (
      <div className="flex gap-2">
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => { setStep("review"); setError(""); }}
        >
          Back
        </Button>
        <Button
          className="flex-1"
          loading={loading}
          disabled={mode === "assign_bed" && (!siteId || !selectedBed)}
          onClick={handleApprove}
        >
          {loading ? "Approving…" : mode === "assign_bed" ? "Approve & assign" : mode === "collect_deposit" ? "Approve & record deposit" : "Approve"}
        </Button>
      </div>
    );

  return (
    <Drawer open onClose={onClose} header={header} footer={footer}>
      <div className="space-y-5">
        {/* Identity — always visible */}
        <div className="flex items-center gap-4">
          <Avatar name={tenant.name} photoUrl={tenant.photo_url} size="lg" />
          <div>
            <p className="text-lg font-bold text-stone-900">{tenant.name}</p>
            <p className="text-sm tabular-nums text-stone-500">{tenant.phone}</p>
            {tenant.email && <p className="text-sm text-stone-400">{tenant.email}</p>}
          </div>
        </div>

        {/* Step: Review — profile details */}
        {step === "review" && (
          <>
            <div className="space-y-3 rounded-xl bg-stone-50 px-4 py-4">
              {tenant.workplace && (
                <Row icon="📍" label="Workplace / College" value={tenant.workplace} />
              )}
              {tenant.address && (
                <Row icon="🏠" label="Home address" value={tenant.address} />
              )}
              {(tenant.emergency_contact_name || tenant.emergency_contact_phone) && (
                <Row icon="🆘" label="Emergency contact"
                  value={[tenant.emergency_contact_name, tenant.emergency_contact_phone].filter(Boolean).join("  ·  ")} />
              )}
              {tenant.aadhaar_number && (
                <Row icon="🪪" label="Aadhaar" value={maskAadhaar(tenant.aadhaar_number)} />
              )}
              <Row icon="📅" label="Registered"
                value={new Date(tenant.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} />
            </div>

            {(idFront || idBack) && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">ID Proof</p>
                <div className="flex gap-3">
                  {idFront && <IdProofTile label="Front" url={idFront} isImage={isImage(idFront)} />}
                  {idBack && <IdProofTile label="Back" url={idBack} isImage={isImage(idBack)} />}
                </div>
              </div>
            )}
          </>
        )}

        {/* Step: Approve — mode selection + fields */}
        {step === "approve" && (
          <>
            {error && <FormError>{error}</FormError>}

            {/* Mode selection */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-700">What would you like to do?</p>
              {(["approve_only", "assign_bed", "collect_deposit"] as ApproveMode[]).map((m) => (
                <label key={m} className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 transition duration-150 ease-out hover:bg-stone-50 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50">
                  <input
                    type="radio"
                    name="approve_mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="mt-0.5 h-4 w-4 text-indigo-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-stone-800">
                      {m === "approve_only" && "Approve only"}
                      {m === "assign_bed" && "Approve & assign bed"}
                      {m === "collect_deposit" && "Approve & collect deposit (assign bed later)"}
                    </p>
                    <p className="text-xs text-stone-500">
                      {m === "approve_only" && "Tenant is approved, bed assigned manually later."}
                      {m === "assign_bed" && "Approve and assign to a specific bed now."}
                      {m === "collect_deposit" && "Collect a deposit/advance now. Bed assigned when tenant moves in."}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Assign bed flow */}
            {mode === "assign_bed" && (
              <div className="space-y-4 rounded-xl border border-stone-200 p-4">
                <Field label="Site">
                  {sitesLoading ? <p className="text-sm text-stone-400">Loading…</p> : (
                    <Select value={siteId} onChange={(e) => setSiteId(e.target.value ? parseInt(e.target.value) : "")}>
                      <option value="">Select a site…</option>
                      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  )}
                </Field>
                {siteId && (
                  <Field label="Bed">
                    {roomsLoading ? <p className="text-sm text-stone-400">Loading…</p> : vacantBeds.length === 0 ? (
                      <p className="text-sm text-stone-400">No vacant beds at this site.</p>
                    ) : (
                      <Select value={selectedBed?.id ?? ""} onChange={(e) => setSelectedBed(vacantBeds.find((b) => b.id === parseInt(e.target.value)) ?? null)}>
                        <option value="">Select a bed…</option>
                        {vacantBeds.map((b) => <option key={b.id} value={b.id}>{b.roomName} — {b.name}</option>)}
                      </Select>
                    )}
                  </Field>
                )}
                {selectedBed && <RentFields rentCycle={rentCycle} setRentCycle={setRentCycle} rentAmount={rentAmount} setRentAmount={setRentAmount} depositAmount={depositAmount} setDepositAmount={setDepositAmount} startDate={startDate} setStartDate={setStartDate} rentLabel={rentLabel} />}
              </div>
            )}

            {/* Collect deposit flow */}
            {mode === "collect_deposit" && (
              <div className="space-y-4 rounded-xl border border-stone-200 p-4">
                <p className="text-xs text-stone-500">The deposit/advance will be recorded as a payment. Bed can be assigned later from the tenant profile.</p>
                <RentFields rentCycle={rentCycle} setRentCycle={setRentCycle} rentAmount={rentAmount} setRentAmount={setRentAmount} depositAmount={depositAmount} setDepositAmount={setDepositAmount} startDate={startDate} setStartDate={setStartDate} rentLabel={rentLabel} />
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PendingPage() {
  const { token, owner } = useAuth();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"registrations" | "payments">("registrations");

  const [pending, setPending] = useState<Tenant[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [drawerTenant, setDrawerTenant] = useState<Tenant | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [payLoading, setPayLoading] = useState(true);
  const [actioningPayId, setActioningPayId] = useState<number | null>(null);

  const registrationUrl = typeof window !== "undefined" ? `${window.location.origin}/register/${owner?.id}` : "";

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
    if (!token) return;
    const ok = await confirm({
      title: "Remove this registration request?",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setRejectingId(id);
    try {
      await tenantsApi.reject(token, id);
      setPending((prev) => prev.filter((t) => t.id !== id));
      if (drawerTenant?.id === id) setDrawerTenant(null);
    } catch { /* ignore */ } finally { setRejectingId(null); }
  }

  function handleApproved(approved: Tenant) {
    setPending((prev) => prev.filter((t) => t.id !== approved.id));
    setDrawerTenant(null);
  }

  async function handleApprovePayment(id: number) {
    if (!token) return;
    setActioningPayId(id);
    try {
      await pendingPaymentsApi.approve(token, id);
      setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ } finally { setActioningPayId(null); }
  }

  async function handleRejectPayment(id: number) {
    if (!token) return;
    const ok = await confirm({
      title: "Reject and delete this payment submission?",
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    setActioningPayId(id);
    try {
      await pendingPaymentsApi.reject(token, id);
      setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    } catch { /* ignore */ } finally { setActioningPayId(null); }
  }

  return (
    <div className="p-8">
      <PageHeader title="Pending" subtitle="Review registrations and payment submissions." />

      <div className="mb-6 flex w-fit gap-1 rounded-xl bg-stone-100 p-1">
        {(["registrations", "payments"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition duration-150 ease-out ${
              tab === t ? "bg-white text-stone-900" : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t === "registrations" ? "Registrations" : "Payment Proofs"}
            {t === "registrations" && pending.length > 0 && (
              <CountBadge tone="warning">{pending.length}</CountBadge>
            )}
            {t === "payments" && pendingPayments.length > 0 && (
              <CountBadge tone="warning">{pendingPayments.length}</CountBadge>
            )}
          </button>
        ))}
      </div>

      {tab === "registrations" && (
        <>
          <div className="mb-6 rounded-xl bg-indigo-50 px-4 py-4 ring-1 ring-indigo-100">
            <p className="mb-1.5 text-sm font-medium text-indigo-900">Tenant registration link</p>
            <p className="mb-3 text-xs text-indigo-600">Share this link (or a QR code pointing to it) with prospective tenants.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-stone-700 ring-1 ring-indigo-200">{registrationUrl}</code>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(registrationUrl)}>Copy</Button>
            </div>
          </div>

          {regLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : pending.length === 0 ? (
            <EmptyState message="No pending registrations." />
          ) : (
            <div className="space-y-3">
              {pending.map((t) => (
                <Card
                  key={t.id}
                  padding="none"
                  className="transition duration-150 ease-out hover:ring-indigo-200"
                >
                  <div className="flex items-center gap-3 px-4 py-4">
                    {/* Avatar + info — click opens drawer */}
                    <button
                      onClick={() => setDrawerTenant(t)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none"
                      aria-label={`View ${t.name}'s profile`}
                    >
                      <Avatar name={t.name} photoUrl={t.photo_url} size="md" />
                      <div className="min-w-0">
                        <p className="font-medium text-stone-900">{t.name}</p>
                        <p className="text-sm text-stone-500">{t.phone}{t.email ? ` · ${t.email}` : ""}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {t.workplace && <span className="text-xs text-stone-400">📍 {t.workplace}</span>}
                          {t.aadhaar_number && <span className="text-xs text-stone-400">🪪 {maskAadhaar(t.aadhaar_number)}</span>}
                          <span className="text-xs text-stone-300">
                            {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Quick actions */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        loading={rejectingId === t.id}
                        onClick={() => handleReject(t.id)}
                      >
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDrawerTenant(t)}>
                        Approve
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "payments" && (
        <>
          {payLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : pendingPayments.length === 0 ? (
            <EmptyState message="No pending payment submissions." />
          ) : (
            <div className="space-y-3">
              {pendingPayments.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium tabular-nums text-stone-900">{p.tenant_name} · {formatCurrency(p.amount)}</p>
                      <p className="text-sm text-stone-500">{p.site_name} · {p.room_name} · {p.bed_name}</p>
                      {p.notes && <p className="mt-0.5 text-xs text-stone-400">&quot;{p.notes}&quot;</p>}
                      <p className="mt-0.5 text-xs text-stone-400">
                        Submitted {new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                      {p.proof_url && (
                        <a href={p.proof_url} target="_blank" rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">
                          View screenshot →
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={actioningPayId === p.id}
                        onClick={() => handleRejectPayment(p.id)}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={actioningPayId === p.id}
                        onClick={() => handleApprovePayment(p.id)}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Unified review + approve drawer */}
      {drawerTenant && token && (
        <ReviewDrawer
          tenant={drawerTenant}
          token={token}
          onDone={handleApproved}
          onReject={handleReject}
          onClose={() => setDrawerTenant(null)}
          rejectingId={rejectingId}
        />
      )}
    </div>
  );
}
