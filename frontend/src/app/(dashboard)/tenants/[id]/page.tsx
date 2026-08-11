"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  tenantsApi, staysApi, paymentsApi, sitesApi, gridApi,
  Tenant, Stay, Payment, TenantSummary, TenantUpdateData, Site, GridRoom,
  formatCurrency, today, maskAadhaar, ApiError, uploadApi,
} from "@/lib/api";

// ─── Helpers ────────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200";
const labelCls = "mb-1 block text-xs font-medium text-stone-500 uppercase tracking-wide";
const fileCls = "w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-500 file:mr-3 file:rounded file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-700 outline-none focus:border-indigo-400";

function ProfileRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className="text-sm text-stone-700">{value}</p>
    </div>
  );
}

function IdLink({ label, url }: { label: string; url?: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      {label}
    </a>
  );
}

// ─── Assign-bed modal ────────────────────────────────────────────────────────

function AssignBedModal({
  stayId, token, onAssigned, onClose,
}: {
  stayId: number; token: string; onAssigned: (stay: Stay) => void; onClose: () => void;
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [grid, setGrid] = useState<GridRoom[]>([]);
  const [selectedBedId, setSelectedBedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sitesApi.list(token).then((s) => {
      setSites(s);
      if (s.length > 0) setSelectedSiteId(s[0].id);
    });
  }, [token]);

  useEffect(() => {
    if (!selectedSiteId) return;
    gridApi.get(token, selectedSiteId).then(setGrid).catch(() => setGrid([]));
  }, [token, selectedSiteId]);

  async function handleAssign() {
    if (!selectedBedId) return;
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.assignBed(token, stayId, { bed_id: selectedBedId });
      onAssigned(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign bed");
    } finally {
      setLoading(false);
    }
  }

  const vacantBeds = grid.flatMap((room) =>
    room.beds
      .filter((b) => b.status === "vacant")
      .map((b) => ({ bedId: b.id, bedName: b.name, roomName: room.name }))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-base font-semibold text-stone-900">Assign Bed</h3>

        {sites.length > 1 && (
          <div className="mb-3">
            <label className={labelCls}>Site</label>
            <select
              value={selectedSiteId ?? ""}
              onChange={(e) => setSelectedSiteId(Number(e.target.value))}
              className={inputCls}
            >
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className={labelCls}>Vacant Beds</label>
          {vacantBeds.length === 0 ? (
            <p className="text-sm text-stone-400">No vacant beds in this site.</p>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {vacantBeds.map((b) => (
                <label key={b.bedId} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50">
                  <input
                    type="radio"
                    name="bed"
                    value={b.bedId}
                    checked={selectedBedId === b.bedId}
                    onChange={() => setSelectedBedId(b.bedId)}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm text-stone-700">{b.roomName} · {b.bedName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleAssign}
            disabled={!selectedBedId || loading}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-500"
          >
            {loading ? "Assigning…" : "Assign"}
          </button>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-stone-500 hover:bg-stone-100">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit profile form ───────────────────────────────────────────────────────

function EditProfileForm({
  tenant, token, onSaved, onCancel,
}: {
  tenant: Tenant; token: string; onSaved: (t: Tenant) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone);
  const [email, setEmail] = useState(tenant.email ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [workplace, setWorkplace] = useState(tenant.workplace ?? "");
  const [emergencyName, setEmergencyName] = useState(tenant.emergency_contact_name ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(tenant.emergency_contact_phone ?? "");
  const [aadhaar, setAadhaar] = useState(tenant.aadhaar_number ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      let photoUrl: string | undefined;
      let idFrontUrl: string | undefined;
      let idBackUrl: string | undefined;

      if (photoFile) photoUrl = await uploadApi.publicUpload(photoFile);
      if (idFrontFile) idFrontUrl = await uploadApi.publicUpload(idFrontFile);
      if (idBackFile) idBackUrl = await uploadApi.publicUpload(idBackFile);

      const data: TenantUpdateData = {
        name,
        phone,
        email: email || undefined,
        address: address || undefined,
        workplace: workplace || undefined,
        emergency_contact_name: emergencyName || undefined,
        emergency_contact_phone: emergencyPhone || undefined,
        aadhaar_number: aadhaar || undefined,
        ...(photoUrl && { photo_url: photoUrl }),
        ...(idFrontUrl && { id_proof_front_url: idFrontUrl, id_proof_url: idFrontUrl }),
        ...(idBackUrl && { id_proof_back_url: idBackUrl }),
      };

      const updated = await tenantsApi.update(token, tenant.id, data);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="mt-4 space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-5">
      <p className="text-sm font-semibold text-stone-800">Edit Profile</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Full name *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone *</label>
          <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Home address</label>
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls + " resize-none"} />
      </div>

      <div>
        <label className={labelCls}>Workplace / College</label>
        <input value={workplace} onChange={(e) => setWorkplace(e.target.value)} className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Emergency contact name</label>
          <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Emergency contact phone</label>
          <input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Aadhaar number</label>
        <input value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} maxLength={12} className={inputCls} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Photo</label>
          <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} className={fileCls} />
        </div>
        <div>
          <label className={labelCls}>ID front</label>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setIdFrontFile(e.target.files?.[0] ?? null)} className={fileCls} />
        </div>
        <div>
          <label className={labelCls}>ID back</label>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setIdBackFile(e.target.files?.[0] ?? null)} className={fileCls} />
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={loading}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 hover:bg-indigo-500">
          {loading ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-stone-500 hover:bg-stone-100">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── End-stay date picker ────────────────────────────────────────────────────

function EndStayPicker({
  stayId, token, onEnded, onCancel,
}: {
  stayId: number; token: string; onEnded: (stay: Stay) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.update(token, stayId, { end_date: date });
      onEnded(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
      <input
        type="date"
        value={date}
        max={today()}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-lg border border-stone-200 px-3 py-1 text-sm outline-none focus:border-indigo-400"
      />
      <button type="submit" disabled={loading}
        className="rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60 hover:bg-red-600">
        {loading ? "…" : "Confirm"}
      </button>
      <button type="button" onClick={onCancel}
        className="rounded-lg px-2 py-1 text-xs text-stone-400 hover:bg-stone-100">
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = Number(id);
  const { token } = useAuth();
  const router = useRouter();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [summary, setSummary] = useState<TenantSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);

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

  // End stay date picker
  const [endingStay, setEndingStay] = useState<number | null>(null);

  // Assign bed modal
  const [assigningStay, setAssigningStay] = useState<number | null>(null);

  const loadSummary = useCallback(() => {
    if (!token) return;
    tenantsApi.summary(token, tenantId).then(setSummary).catch(() => {});
  }, [token, tenantId]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      tenantsApi.get(token, tenantId),
      tenantsApi.stays(token, tenantId),
    ])
      .then(([t, s]) => { setTenant(t); setStays(s); })
      .catch(() => router.replace("/tenants"))
      .finally(() => setLoading(false));
    loadSummary();
  }, [token, tenantId, router, loadSummary]);

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
      loadSummary();
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
    loadSummary();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const idProofFront = tenant?.id_proof_front_url ?? tenant?.id_proof_url;
  const idProofBack = tenant?.id_proof_back_url;

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-2 text-sm text-stone-500">
        <Link href="/tenants" className="hover:text-indigo-600">Tenants</Link>
        <span>/</span>
        <span className="text-stone-800">{tenant?.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-600 overflow-hidden">
          {tenant?.photo_url
            ? <img src={tenant.photo_url} alt={tenant.name} className="h-full w-full object-cover" />
            : tenant?.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-stone-900">{tenant?.name}</h1>
          <p className="text-sm text-stone-500">{tenant?.phone}</p>
          {tenant?.email && <p className="text-sm text-stone-500">{tenant.email}</p>}
        </div>
        <button
          onClick={() => setEditingProfile((v) => !v)}
          className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
        >
          {editingProfile ? "Cancel edit" : "Edit profile"}
        </button>
      </div>

      {/* Profile card */}
      {!editingProfile && tenant && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <ProfileRow label="Home address" value={tenant.address} />
            <ProfileRow label="Workplace / College" value={tenant.workplace} />
            <ProfileRow label="Emergency contact" value={
              tenant.emergency_contact_name
                ? `${tenant.emergency_contact_name}${tenant.emergency_contact_phone ? ` · ${tenant.emergency_contact_phone}` : ""}`
                : undefined
            } />
            <ProfileRow label="Aadhaar" value={tenant.aadhaar_number ? maskAadhaar(tenant.aadhaar_number) : undefined} />
            {(idProofFront || idProofBack) && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-stone-400">ID proof</p>
                <div className="mt-1 flex gap-3">
                  <IdLink label="Front" url={idProofFront} />
                  <IdLink label="Back" url={idProofBack} />
                </div>
              </div>
            )}
          </div>

          {/* No profile details placeholder */}
          {!tenant.address && !tenant.workplace && !tenant.emergency_contact_name && !tenant.aadhaar_number && !idProofFront && (
            <p className="text-sm text-stone-400">No additional profile details. Click "Edit profile" to add.</p>
          )}
        </div>
      )}

      {/* Edit profile form */}
      {editingProfile && tenant && token && (
        <EditProfileForm
          tenant={tenant}
          token={token}
          onSaved={(updated) => { setTenant(updated); setEditingProfile(false); }}
          onCancel={() => setEditingProfile(false)}
        />
      )}

      {/* Financial summary bar */}
      {summary && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Total paid</p>
            <p className="mt-1 text-xl font-bold text-stone-900">{formatCurrency(summary.total_paid)}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Stay duration</p>
            <p className="mt-1 text-xl font-bold text-stone-900">{summary.duration_days}d</p>
          </div>
          <div className={`rounded-xl p-4 shadow-sm ring-1 text-center ${
            summary.balance <= 0
              ? "bg-green-50 ring-green-200"
              : "bg-red-50 ring-red-200"
          }`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Balance</p>
            <p className={`mt-1 text-xl font-bold ${summary.balance <= 0 ? "text-green-700" : "text-red-700"}`}>
              {summary.balance <= 0
                ? `${formatCurrency(Math.abs(summary.balance))} ahead`
                : `${formatCurrency(summary.balance)} owed`}
            </p>
          </div>
        </div>
      )}

      {/* Stays */}
      <h2 className="mb-3 text-base font-semibold text-stone-900">Stays & Ledger</h2>

      {stays.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-200 py-12 text-center text-sm text-stone-400">
          No stays recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => {
            const active = !stay.end_date;
            const unassigned = stay.bed_id == null;
            const stayPayments = payments[stay.id];
            const totalPaid = (stayPayments || []).reduce((s, p) => s + p.amount, 0);
            const isEndingThis = endingStay === stay.id;

            return (
              <div key={stay.id} className="rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
                {/* Stay header */}
                <div
                  onClick={() => { if (!isEndingThis) toggleStay(stay.id); }}
                  className="flex w-full cursor-pointer items-start justify-between px-5 py-4 text-left"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        active ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"
                      }`}>
                        {active ? "Active" : "Ended"}
                      </span>
                      {unassigned ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Bed unassigned
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-stone-700">
                          Bed #{stay.bed_id}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-stone-400">
                      {stay.start_date.slice(0, 10)}
                      {stay.end_date ? ` → ${stay.end_date.slice(0, 10)}` : " → present"}
                      {" · "}
                      {formatCurrency(stay.rent_amount)}/{stay.rent_cycle}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-stone-700">
                      Paid {formatCurrency(totalPaid)}
                    </p>
                    {active && (
                      <div className="mt-1 flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        {unassigned && !isEndingThis && (
                          <button
                            onClick={() => setAssigningStay(stay.id)}
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Assign bed
                          </button>
                        )}
                        {!isEndingThis && (
                          <button
                            onClick={() => setEndingStay(stay.id)}
                            className="text-xs text-stone-400 hover:text-red-500"
                          >
                            End stay
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* End-stay date picker */}
                {isEndingThis && token && (
                  <div className="border-t border-stone-100 px-5 py-3">
                    <p className="mb-2 text-xs font-medium text-stone-500">Select move-out date:</p>
                    <EndStayPicker
                      stayId={stay.id}
                      token={token}
                      onEnded={(updated) => {
                        setStays((prev) => prev.map((s) => (s.id === stay.id ? updated : s)));
                        setEndingStay(null);
                        loadSummary();
                      }}
                      onCancel={() => setEndingStay(null)}
                    />
                  </div>
                )}

                {/* Expanded: payment ledger */}
                {expanded === stay.id && (
                  <div className="border-t border-stone-100 px-5 py-4">
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
                              className="w-32 rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            />
                            <select
                              value={payType}
                              onChange={(e) => setPayType(e.target.value)}
                              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            >
                              <option value="cash">Cash</option>
                              <option value="online">Online</option>
                            </select>
                            <input
                              type="date"
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                            />
                            <input
                              placeholder="Notes"
                              value={payNotes}
                              onChange={(e) => setPayNotes(e.target.value)}
                              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
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
                              className="rounded-lg px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-100"
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Payments list */}
                    {stayPayments === undefined ? (
                      <p className="text-xs text-stone-400">Loading…</p>
                    ) : stayPayments.length === 0 ? (
                      <p className="text-xs text-stone-400">No payments recorded.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                            <th className="pb-2">Date</th>
                            <th className="pb-2">Amount</th>
                            <th className="pb-2">Type</th>
                            <th className="pb-2">Notes</th>
                            <th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-50">
                          {stayPayments.map((p) => (
                            <tr key={p.id} className="group">
                              <td className="py-2 text-stone-600">{p.payment_date.slice(0, 10)}</td>
                              <td className="py-2 font-medium text-stone-800">{formatCurrency(p.amount)}</td>
                              <td className="py-2 capitalize text-stone-500">{p.payment_type}</td>
                              <td className="py-2 text-stone-400">{p.notes || "—"}</td>
                              <td className="py-2 text-right">
                                <button
                                  onClick={() => handleDeletePayment(stay.id, p.id)}
                                  className="hidden text-stone-300 transition hover:text-red-500 group-hover:inline"
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

      {/* Assign bed modal */}
      {assigningStay !== null && token && (
        <AssignBedModal
          stayId={assigningStay}
          token={token}
          onAssigned={(updated) => {
            setStays((prev) => prev.map((s) => (s.id === assigningStay ? updated : s)));
            setAssigningStay(null);
          }}
          onClose={() => setAssigningStay(null)}
        />
      )}
    </div>
  );
}
