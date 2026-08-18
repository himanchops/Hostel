"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import {
  tenantsApi, staysApi, paymentsApi, sitesApi, gridApi,
  Tenant, Stay, Payment, TenantSummary, TenantUpdateData, Site, GridRoom,
  formatCurrency, today, maskAadhaar, ApiError, uploadApi,
} from "@/lib/api";
import {
  Badge,
  BedIcon,
  Button,
  Card,
  EmptyState,
  Field,
  FileInput,
  FormError,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useConfirm,
} from "@/components/ui";
import { EndStayDialog } from "@/components/EndStayDialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    <Modal
      open
      onClose={onClose}
      title="Assign Bed"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!selectedBedId} loading={loading} onClick={handleAssign}>
            {loading ? "Assigning…" : "Assign"}
          </Button>
        </>
      }
    >
      {sites.length > 1 && (
        <Field label="Site" className="mb-3">
          <Select
            value={selectedSiteId ?? ""}
            onChange={(e) => setSelectedSiteId(Number(e.target.value))}
          >
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}

      <div className="mb-4">
        <p className="mb-1 text-[13px] font-medium text-stone-600">Vacant Beds</p>
        {vacantBeds.length === 0 ? (
          <p className="text-sm text-stone-400">No vacant beds in this site.</p>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {vacantBeds.map((b) => (
              <label key={b.bedId} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition duration-150 ease-out hover:bg-stone-50">
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

      {error && <FormError>{error}</FormError>}
    </Modal>
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
    <form onSubmit={handleSave} className="mt-4 space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <p className="text-sm font-semibold text-stone-800">Edit Profile</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" required>
          <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>

      <Field label="Home address">
        <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="resize-none" />
      </Field>

      <Field label="Workplace / College">
        <Input value={workplace} onChange={(e) => setWorkplace(e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Emergency contact name">
          <Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
        </Field>
        <Field label="Emergency contact phone">
          <Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
        </Field>
      </div>

      <Field label="Aadhaar number">
        <Input value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} maxLength={12} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Photo">
          <FileInput accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="ID front">
          <FileInput accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setIdFrontFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="ID back">
          <FileInput accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setIdBackFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>

      {error && <FormError>{error}</FormError>}

      <div className="flex gap-2">
        <Button type="submit" loading={loading}>
          {loading ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = Number(id);
  const { token } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();

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
    if (!token) return;
    const ok = await confirm({ title: "Delete this payment?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    await paymentsApi.delete(token, paymentId);
    setPayments((prev) => ({ ...prev, [stayId]: prev[stayId].filter((p) => p.id !== paymentId) }));
    loadSummary();
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const idProofFront = tenant?.id_proof_front_url ?? tenant?.id_proof_url;
  const idProofBack = tenant?.id_proof_back_url;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        breadcrumb={[{ label: "Tenants", href: "/tenants" }, { label: tenant?.name ?? "" }]}
        title={
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-xl font-bold text-indigo-600">
              {tenant?.photo_url
                ? <img src={tenant.photo_url} alt={tenant.name} className="h-full w-full object-cover" />
                : tenant?.name[0]?.toUpperCase()}
            </span>
            <span>
              {tenant?.name}
              <span className="block text-sm font-normal tabular-nums text-stone-500">{tenant?.phone}</span>
              {tenant?.email && <span className="block text-sm font-normal text-stone-500">{tenant.email}</span>}
            </span>
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => setEditingProfile((v) => !v)}>
            {editingProfile ? "Cancel edit" : "Edit profile"}
          </Button>
        }
      />

      {/* Profile card */}
      {!editingProfile && tenant && (
        <Card className="mb-6">
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
            <p className="text-sm text-stone-400">No additional profile details. Click &quot;Edit profile&quot; to add.</p>
          )}
        </Card>
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
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Total paid</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">{formatCurrency(summary.total_paid)}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Stay duration</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">{summary.duration_days}d</p>
          </Card>
          <Card className={`text-center ${summary.balance <= 0 ? "bg-paid-50" : "bg-overdue-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Balance</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${summary.balance <= 0 ? "text-paid-800" : "text-overdue-800"}`}>
              {summary.balance <= 0
                ? `${formatCurrency(Math.abs(summary.balance))} ahead`
                : `${formatCurrency(summary.balance)} owed`}
            </p>
          </Card>
        </div>
      )}

      {/* Stays */}
      <h2 className="mb-3 text-base font-semibold text-stone-900">Stays &amp; Ledger</h2>

      {stays.length === 0 ? (
        <EmptyState
          icon={<BedIcon className="h-8 w-8" />}
          title="No stays yet"
          message="Assign this tenant to a bed and their rent ledger starts here."
        />
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => {
            const active = !stay.end_date;
            const unassigned = stay.bed_id == null;
            const stayPayments = payments[stay.id];
            const totalPaid = (stayPayments || []).reduce((s, p) => s + p.amount, 0);
            const isEndingThis = endingStay === stay.id;

            return (
              <Card key={stay.id} padding="none">
                {/* Stay header */}
                <div
                  onClick={() => { if (!isEndingThis) toggleStay(stay.id); }}
                  className="flex w-full cursor-pointer items-start justify-between px-4 py-3 text-left"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={active ? "success" : "neutral"}>
                        {active ? "Active" : "Ended"}
                      </Badge>
                      {unassigned ? (
                        <Badge tone="warning">Bed unassigned</Badge>
                      ) : (
                        <span className="text-sm font-medium text-stone-700">
                          Bed #{stay.bed_id}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-stone-400">
                      {stay.start_date.slice(0, 10)}
                      {stay.end_date ? ` → ${stay.end_date.slice(0, 10)}` : " → present"}
                      {" · "}
                      {formatCurrency(stay.rent_amount)}/{stay.rent_cycle}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-stone-700">
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
                            className="text-xs text-stone-400 transition duration-150 ease-out hover:text-red-500"
                          >
                            End stay
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded: payment ledger */}
                {expanded === stay.id && (
                  <div className="border-t border-stone-100 px-4 py-3">
                    {/* Add payment */}
                    {active && (
                      <div className="mb-4">
                        {addingPayment !== stay.id ? (
                          <Button size="sm" onClick={() => setAddingPayment(stay.id)}>
                            + Add payment
                          </Button>
                        ) : (
                          <form
                            onSubmit={(e) => handleAddPayment(e, stay.id)}
                            className="flex flex-wrap items-end gap-2"
                          >
                            {payError && <p className="w-full text-xs text-red-600">{payError}</p>}
                            <Input
                              required
                              type="number"
                              placeholder="Amount (₹)"
                              value={payAmount}
                              onChange={(e) => setPayAmount(e.target.value)}
                              className="w-32"
                            />
                            <Select
                              value={payType}
                              onChange={(e) => setPayType(e.target.value)}
                              className="w-auto"
                            >
                              <option value="cash">Cash</option>
                              <option value="online">Online</option>
                            </Select>
                            <Input
                              type="date"
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              className="w-auto"
                            />
                            <Input
                              placeholder="Notes"
                              value={payNotes}
                              onChange={(e) => setPayNotes(e.target.value)}
                              className="w-40"
                            />
                            <Button type="submit" size="sm" loading={payLoading}>
                              {payLoading ? "…" : "Save"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setAddingPayment(null)}
                            >
                              Cancel
                            </Button>
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
                              <td className="py-2 tabular-nums text-stone-600">{p.payment_date.slice(0, 10)}</td>
                              <td className="py-2 font-medium tabular-nums text-stone-800">{formatCurrency(p.amount)}</td>
                              <td className="py-2 capitalize text-stone-500">{p.payment_type}</td>
                              <td className="py-2 text-stone-400">{p.notes || "—"}</td>
                              <td className="py-2 text-right">
                                <button
                                  onClick={() => handleDeletePayment(stay.id, p.id)}
                                  className="hidden text-stone-300 transition duration-150 ease-out hover:text-red-500 group-hover:inline"
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
              </Card>
            );
          })}
        </div>
      )}

      {/* Ending a stay is the same dialog the grid uses, so a departure
          recorded late is billed to the day it happened either way. */}
      {token && (
        <EndStayDialog
          open={endingStay !== null}
          stayId={endingStay}
          token={token}
          tenantName={tenant?.name}
          onEnded={(updated) => {
            setStays((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setEndingStay(null);
            loadSummary();
          }}
          onClose={() => setEndingStay(null)}
        />
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
