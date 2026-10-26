"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import {
  tenantsApi, staysApi, paymentsApi, settlementsApi,
  Tenant, Stay, Payment, PaymentKind, TenantSummary, TenantUpdateData, Settlement,
  formatCurrency, formatDay, today, latestPaymentDate, maskAadhaar, ApiError, uploadApi, withPlace,
} from "@/lib/api";
import { dueLine } from "@/lib/due";
import { depositSummary } from "@/lib/settlement";
import {
  Badge,
  BedIcon,
  Button,
  Card,
  EmptyState,
  Field,
  FileInput,
  FormError,
  HOVER_REVEAL,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  Textarea,
  TOUCH_LINK,
  useConfirm,
  useToast,
  SegmentedControl,
} from "@/components/ui";
import { PAY_METHODS, PayMethod, payMethodLabel } from "@/lib/payMethod";
import { PaymentStatus, RejectionReason } from "@/components/PaymentStatus";
import {
  BedPicker, VacantBed,
  PaidTodayFields, PaidToday, PaidSuggestion, emptyPaidToday,
  paidTodayError, paidTodaySuffix, recordPaidToday,
} from "@/components/StayForm";
import { PortalPasswordDialog } from "@/components/PortalPasswordDialog";
import { RecordNoticeDialog } from "@/components/RecordNoticeDialog";
import { ChangeRentDialog } from "@/components/ChangeRentDialog";
import { MoveBedDialog } from "@/components/MoveBedDialog";
import { NewStayDialog } from "@/components/NewStayDialog";
import { MoveOutSheet } from "@/components/MoveOutSheet";
import { checkPhones } from "@/lib/phone";

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
      className={`${TOUCH_LINK} gap-1 text-xs font-medium text-indigo-600 hover:underline`}>
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      {label}
    </a>
  );
}

// ─── Assign-bed modal ────────────────────────────────────────────────────────

function AssignBedModal({
  stay, token, onAssigned, onClose,
}: {
  stay: Stay;
  token: string;
  /** `paid` is " · ₹3,000 paid" or ""; `missed` names a payment not recorded. */
  onAssigned: (paid: string, missed: string) => void;
  onClose: () => void;
}) {
  const [bed, setBed] = useState<VacantBed | null>(null);
  // Usually a booking arriving. Rent runs from the day they booked for, which
  // the owner moves when they come early or late.
  const booked = stay.start_date.slice(0, 10);
  const [rentFrom, setRentFrom] = useState(booked);
  // What is still owed on the first rent period and the deposit, once the
  // stay's payments arrive: what they paid to book counts towards both.
  const [suggested, setSuggested] = useState<PaidSuggestion | null>(null);
  const [paid, setPaid] = useState<PaidToday>(emptyPaidToday());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    staysApi.payments(token, stay.id)
      .then((ps) => {
        if (cancelled) return;
        const sum = (kind: PaymentKind) =>
          ps.filter((p) => p.is_approved && p.kind === kind).reduce((n, p) => n + p.amount, 0);
        const left = (agreed: number, got: number) => {
          const rest = Math.max(0, agreed - got);
          return rest > 0 ? String(rest / 100) : "";
        };
        setSuggested({
          rent: left(stay.rent_amount, sum("rent")),
          deposit: left(stay.deposit_amount, sum("deposit")),
        });
      })
      .catch(() => {
        // Without the payments there is no honest suggestion; the boxes start
        // empty and the owner types what arrived.
        if (!cancelled) setSuggested({ rent: "", deposit: "" });
      });
    return () => { cancelled = true; };
  }, [token, stay.id, stay.rent_amount, stay.deposit_amount]);

  const money = suggested ?? { rent: "", deposit: "" };

  async function handleAssign() {
    if (!bed) return;
    const invalid = !rentFrom ? "Pick the day rent runs from." : paidTodayError(paid, money);
    if (invalid) { setError(invalid); return; }
    setError("");
    setLoading(true);
    try {
      if (rentFrom !== booked) await staysApi.update(token, stay.id, { start_date: rentFrom });
      await staysApi.assignBed(token, stay.id, { bed_id: bed.id });
      const missed = await recordPaidToday(token, stay.id, paid, money, today());
      onAssigned(missed ? "" : paidTodaySuffix(paid, money), missed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign bed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign bed"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!bed || !suggested} loading={loading} onClick={handleAssign}>
            {loading ? "Assigning…" : `Assign${paidTodaySuffix(paid, money)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <BedPicker token={token} value={bed} onChange={setBed} />
        <Field label="Rent from" hint={rentFrom === booked ? "The day they booked for." : `Booked for ${formatDay(booked)}.`}>
          <Input type="date" value={rentFrom} onChange={(e) => setRentFrom(e.target.value)} className="w-auto" />
        </Field>
        {suggested && (
          <PaidTodayFields
            value={paid}
            onChange={setPaid}
            suggested={suggested}
            date={today()}
            cycle={stay.rent_cycle}
            rentLabel="Rent still due (₹)"
            hint="Filled in with what's left after anything they paid to book."
          />
        )}
        {error && <FormError>{error}</FormError>}
      </div>
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
  const [address, setAddress] = useState(tenant.address ?? "");
  const [workplace, setWorkplace] = useState(tenant.workplace ?? "");
  const [emergencyName, setEmergencyName] = useState(tenant.emergency_contact_name ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(tenant.emergency_contact_phone ?? "");
  const [aadhaar, setAadhaar] = useState(tenant.aadhaar_number ?? "");
  const [notes, setNotes] = useState(tenant.notes ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    const phones = checkPhones(phone, emergencyPhone);
    if ("error" in phones) { setError(phones.error); return; }
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
        phone: phones.phone,
        address: address || undefined,
        workplace: workplace || undefined,
        emergency_contact_name: emergencyName || undefined,
        emergency_contact_phone: phones.emergency,
        aadhaar_number: aadhaar || undefined,
        notes: notes.trim() || undefined,
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

      <Field label="Home address">
        <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="resize-none" />
      </Field>

      <Field label="Workplace / College">
        <Input value={workplace} onChange={(e) => setWorkplace(e.target.value)} />
      </Field>

      <Field label="Notes" hint="Only you see this. Tenants never do.">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
  const toast = useToast();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [summary, setSummary] = useState<TenantSummary | null>(null);
  const dueNote = summary ? dueLine(summary) : null;
  // Keyed by stay so an ended stay can be badged without a request each.
  const [settlements, setSettlements] = useState<Record<number, Settlement>>({});
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);

  // Every stay's payments, loaded with the page, and which ledger is open.
  const [payments, setPayments] = useState<Record<number, Payment[]>>({});
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Add payment inline
  const [addingPayment, setAddingPayment] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payKind, setPayKind] = useState<PaymentKind>("rent");
  const [payType, setPayType] = useState<PayMethod>("cash");
  const [payDate, setPayDate] = useState(today());
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState("");
  const [payLoading, setPayLoading] = useState(false);

  // Moving out (or settling the money for a stay that already ended)
  const [settlingStay, setSettlingStay] = useState<number | null>(null);
  const [settlingBooking, setSettlingBooking] = useState(false);
  // Recording (or amending) a notice — the plan to leave, not the leaving.
  const [noticeStay, setNoticeStay] = useState<Stay | null>(null);
  const [rentStay, setRentStay] = useState<Stay | null>(null);
  const [movingStay, setMovingStay] = useState<Stay | null>(null);
  const [startingStay, setStartingStay] = useState(false);

  // Assign bed modal
  const [assigningStay, setAssigningStay] = useState<Stay | null>(null);

  // Portal password — the only way a hand-typed tenant ever reaches /my.
  const [settingPassword, setSettingPassword] = useState(false);

  // Settling ends the stay server-side, and the response is the settlement
  // rather than the stay — so the card's dates come from a refetch.
  // A new stay arrives with no ledger loaded, so the ledgers come back too.
  const reloadStays = useCallback(() => {
    if (!token) return;
    tenantsApi.stays(token, tenantId)
      .then((s) => {
        setStays(s);
        return Promise.all(s.map((st) => staysApi.payments(token, st.id).then((p) => [st.id, p] as const)))
          .then((loaded) => setPayments(Object.fromEntries(loaded)));
      })
      .catch(() => {
        toast.error("Saved, but the stays did not refresh — reload the page");
      });
  }, [token, tenantId, toast]);

  const loadSummary = useCallback(() => {
    if (!token) return;
    tenantsApi.summary(token, tenantId).then(setSummary).catch(() => {});
  }, [token, tenantId]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      tenantsApi.get(token, tenantId),
      tenantsApi.stays(token, tenantId),
      // A tenant with no settlements is the common case, so a failure here
      // must not cost them the page — it only removes a badge.
      settlementsApi.listByTenant(token, tenantId).catch(() => [] as Settlement[]),
    ])
      .then(([t, s, settled]) => {
        setTenant(t);
        setStays(s);
        setSettlements(Object.fromEntries(settled.map((x) => [x.stay_id, x])));
        // One stay means there is nothing to choose between: open it.
        if (s.length === 1) setExpanded(s[0].id);

        // Every ledger loads with the page. They used to load on expand, which
        // was fine until the expander turned out to be invisible (UX audit M1):
        // five of seven testers never opened it, "Paid —" became the permanent
        // state, and one re-recorded a payment already saved. A tenant has a
        // handful of stays, and a request each is cheaper than a figure nobody
        // sees. A failure must not cost them the page, so it is reported where
        // the ledger would have been.
        Promise.all(s.map((st) => staysApi.payments(token, st.id).then((p) => [st.id, p] as const)))
          .then((loaded) => setPayments(Object.fromEntries(loaded)))
          .catch(() => setPaymentsFailed(true));
      })
      .catch(() => router.replace("/tenants"))
      .finally(() => setLoading(false));
    loadSummary();
  }, [token, tenantId, router, loadSummary]);

  function toggleStay(stayId: number) {
    setExpanded((open) => (open === stayId ? null : stayId));
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
        kind: payKind,
        payment_date: payDate,
        notes: payNotes || undefined,
      });
      setPayments((prev) => ({ ...prev, [stayId]: [p, ...(prev[stayId] || [])] }));
      setPayAmount("");
      setPayNotes("");
      setPayKind("rent");
      setAddingPayment(null);
      loadSummary();
      toast.success(`Recorded ${formatCurrency(p.amount)}${p.kind === "deposit" ? " deposit" : ""}`);
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
    try {
      await paymentsApi.delete(token, paymentId);
      setPayments((prev) => ({ ...prev, [stayId]: prev[stayId].filter((p) => p.id !== paymentId) }));
      loadSummary();
      toast.success("Payment deleted");
    } catch {
      toast.error("Failed to delete the payment");
    }
  }

  const settlementsCount = Object.keys(settlements).length;

  async function handleDeleteTenant() {
    if (!token || !tenant) return;
    // Counted from what this page already loaded, so the dialog states the
    // cost before the button is offered — this is the one action in the app
    // that destroys payment records.
    const all = Object.values(payments).flat();
    const received = all.filter((p) => p.is_approved).reduce((sum, p) => sum + p.amount, 0);
    const parts = [
      stays.length > 0 && `${stays.length} ${stays.length === 1 ? "stay" : "stays"}`,
      all.length > 0 && `${all.length} ${all.length === 1 ? "payment" : "payments"} (${formatCurrency(received)} received)`,
      settlementsCount > 0 && `${settlementsCount} ${settlementsCount === 1 ? "settlement" : "settlements"}`,
    ].filter(Boolean);
    const ok = await confirm({
      title: `Delete ${tenant.name}?`,
      message: (
        <>
          {parts.length > 0
            ? <>This permanently deletes them along with {parts.join(", ")}. </>
            : <>This permanently deletes them. </>}
          {stays.some((s) => !s.end_date && s.bed_id) && <>Their bed becomes vacant. </>}
          It cannot be undone. Meant for a test entry or a duplicate — to record
          that someone left, end their stay instead.
        </>
      ),
      confirmLabel: "Delete tenant",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await tenantsApi.delete(token, tenant.id);
      toast.success(`${tenant.name} deleted`);
      router.replace("/tenants");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete the tenant");
    }
  }

  if (loading) {
    return <PageLoader className="min-h-[60vh]" />;
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
            {/* A number with no name is still a contact: the notebook import
                brought in many second numbers nobody labelled. */}
            <ProfileRow label="Emergency contact" value={
              [tenant.emergency_contact_name, tenant.emergency_contact_phone].filter(Boolean).join(" · ") || undefined
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

          {tenant.notes && (
            <div className="mt-4 border-t border-stone-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Notes</p>
              <p className="whitespace-pre-line text-sm text-stone-700">{tenant.notes}</p>
            </div>
          )}

          {/* No profile details placeholder */}
          {!tenant.address && !tenant.workplace && !tenant.emergency_contact_name && !tenant.emergency_contact_phone
            && !tenant.aadhaar_number && !tenant.notes && !idProofFront && (
            <p className="text-sm text-stone-400">No additional profile details. Click &quot;Edit profile&quot; to add.</p>
          )}
        </Card>
      )}

      {/* Edit profile form */}
      {editingProfile && tenant && token && (
        <EditProfileForm
          tenant={tenant}
          token={token}
          onSaved={(updated) => {
            setTenant(updated);
            setEditingProfile(false);
            toast.success("Profile updated");
          }}
          onCancel={() => setEditingProfile(false)}
        />
      )}

      {/* Financial summary bar. Three across from sm up; on a phone, two
          across with Balance on its own row, because a third of 375px cannot
          hold "₹10,50,000" and the figure ran into the next tile. */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card className="text-center">
            {/* Rent only, on purpose: a deposit is held, not paid towards
                anything. Said in the label, and the deposit gets its own line,
                so recording one here never looks like it went missing. */}
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Rent paid</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">{formatCurrency(summary.total_paid)}</p>
            {summary.deposit_held > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-stone-500">+ {formatCurrency(summary.deposit_held)} deposit held</p>
            )}
            {summary.deposit_due > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-amber-700">deposit {formatCurrency(summary.deposit_due)} not yet paid</p>
            )}
          </Card>
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Stay duration</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">
              {/* Someone who has only booked has stayed no nights yet. */}
              {summary.duration_days === 0 && stays.some((s) => !s.end_date && s.bed_id == null)
                ? "Not arrived"
                : `${summary.duration_days}d`}
            </p>
          </Card>
          <Card className={`col-span-2 text-center sm:col-span-1 ${summary.balance <= 0 ? "bg-paid-50!" : "bg-overdue-50!"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Balance</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${summary.balance <= 0 ? "text-paid-800" : "text-overdue-800"}`}>
              {summary.balance <= 0
                ? `${formatCurrency(Math.abs(summary.balance))} ahead`
                : `${formatCurrency(summary.balance)} owed`}
            </p>
            {dueNote && (
              <p className={`mt-0.5 text-xs font-medium ${dueNote.tone === "danger" ? "text-overdue-700" : dueNote.tone === "warning" ? "text-amber-700" : "text-stone-500"}`}>
                {dueNote.text}
              </p>
            )}
          </Card>
        </div>
      )}

      {/* Portal access */}
      {tenant && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-stone-900">Tenant portal</p>
              <p className="mt-0.5 text-[13px] text-stone-500">
                {tenant.has_portal_login
                  ? `Signs in at /my with ${tenant.phone} and their password.`
                  : "No login yet — they cannot see their ledger, submit a payment, or give notice online."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={tenant.has_portal_login ? "success" : "neutral"}>
                {tenant.has_portal_login ? "Can sign in" : "No login"}
              </Badge>
              <Button variant="secondary" onClick={() => setSettingPassword(true)}>
                {tenant.has_portal_login ? "Reset password" : "Create login"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Stays */}
      {/* Someone with no open stay can be given a new one: a tenant who left
          and came back gets a fresh stay here, beside their history, rather
          than a second record from Add tenant. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Stays &amp; Ledger</h2>
        {stays.length > 0 && !stays.some((s) => !s.end_date) && (
          <Button size="sm" onClick={() => setStartingStay(true)}>Start a new stay</Button>
        )}
      </div>

      {stays.length === 0 ? (
        <EmptyState
          icon={<BedIcon className="h-8 w-8" />}
          title="No stays yet"
          message="Put them in a bed, or book them in, and their rent ledger starts here."
          action={<Button size="sm" onClick={() => setStartingStay(true)}>Start a stay</Button>}
        />
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => {
            const active = !stay.end_date;
            const unassigned = stay.bed_id == null;
            // An open stay with no bed is a booking: someone holding a place
            // until the day they arrive. One that ended with no bed was
            // cancelled, and billed nothing (endedCycles, helpers.go).
            const booked = active && unassigned;
            const stayPayments = payments[stay.id];
            // Rent and deposit are different money: "Paid" is rent, the same
            // figure as the summary above, and the deposit gets its own line.
            const approved = (stayPayments || []).filter((p) => p.is_approved);
            const rentPaid = approved.filter((p) => p.kind === "rent").reduce((s, p) => s + p.amount, 0);
            const depositPaid = approved.filter((p) => p.kind === "deposit").reduce((s, p) => s + p.amount, 0);
            const deposit = depositSummary(stay.deposit_amount, stayPayments === undefined ? undefined : depositPaid);
            const settlement = settlements[stay.id];
            const open = expanded === stay.id;
            const ledgerId = `ledger-${stay.id}`;

            return (
              <Card key={stay.id} padding="none">
                {/* Stay header — information and actions only. This used to be
                    the expander itself: a clickable <div> whose one affordance
                    was cursor-pointer, which a touchscreen does not have. The
                    ledger now has a button of its own, below. */}
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={active ? (booked ? "info" : "success") : "neutral"}>
                        {active ? (booked ? "Booked" : "Active") : unassigned ? "Booking cancelled" : "Ended"}
                      </Badge>
                      {settlement && <Badge tone="info">Settled</Badge>}
                      {active && !booked && stay.expected_end_date && (
                        <Badge
                          tone={
                            stay.expected_end_date.slice(0, 10) < today()
                              ? "danger"
                              : "warning"
                          }
                        >
                          {stay.expected_end_date.slice(0, 10) < today()
                            ? `Was due to leave ${stay.expected_end_date.slice(0, 10)}`
                            : `Leaving ${stay.expected_end_date.slice(0, 10)}`}
                        </Badge>
                      )}
                      {active && !booked && stay.notice_date && !stay.expected_end_date && (
                        <Badge tone="warning">
                          Notice {stay.notice_date.slice(0, 10)}
                        </Badge>
                      )}
                      {booked ? (
                        // A promise of a place, not a particular bed. The
                        // owner gives one when they arrive.
                        <span className="text-sm font-medium text-stone-700">
                          {stay.start_date.slice(0, 10) > today()
                            ? `Arrives ${formatDay(stay.start_date)}`
                            : `Was due ${formatDay(stay.start_date)} · no bed yet`}
                        </span>
                      ) : unassigned ? (
                        active ? <Badge tone="warning">Bed unassigned</Badge> : null
                      ) : (
                        // The room and bed as the grid names them. This used
                        // to print the database id ("Bed #31"), and five of
                        // seven testers took the page for broken (UX audit M7).
                        <span className="text-sm font-medium text-stone-700">
                          {stay.room_name && stay.bed_name
                            ? `${stay.room_name} · ${stay.bed_name}`
                            : "Bed assigned"}
                          {stay.site_name && (
                            <span className="font-normal text-stone-400"> · {stay.site_name}</span>
                          )}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-stone-400">
                      {stay.start_date.slice(0, 10)}
                      {stay.end_date ? ` → ${stay.end_date.slice(0, 10)}` : " → present"}
                      {" · "}
                      {stay.rent_changes && stay.rent_changes.length > 1
                        ? <>
                            {formatCurrency(stay.rent_changes[0].rent_amount)}/{stay.rent_cycle}
                            {stay.rent_changes.slice(1).map((c) => (
                              <span key={c.effective_date} className="whitespace-nowrap">
                                {" → "}{formatCurrency(c.rent_amount)} from {formatDay(c.effective_date)}
                              </span>
                            ))}
                          </>
                        : <>{formatCurrency(stay.rent_amount)}/{stay.rent_cycle}</>}
                    </p>
                    {/* Keyed by position: moving A → B → A on one day repeats
                        both the date and the bed. */}
                    {stay.moves?.map((m, i) => (
                      <p key={i} className="mt-0.5 text-xs text-stone-500">
                        Moved from {m.from_room_name && m.from_bed_name ? `${m.from_room_name} · ${m.from_bed_name}` : "a bed since removed"}
                        {" "}on {formatDay(m.moved_on)}
                      </p>
                    ))}
                    {deposit && (
                      <p className="mt-0.5 text-xs tabular-nums text-stone-500">{deposit}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {/* Until the payments arrive the total is unknown, not 0 —
                        and saying ₹0 next to a refund figure would be a money
                        lie. The dash now only lasts as long as the request. */}
                    <p className="text-sm font-semibold tabular-nums text-stone-700">
                      {stayPayments === undefined ? "Paid —" : `Paid ${formatCurrency(rentPaid)}`}
                    </p>
                    {settlement && (
                      <p className={`text-xs font-medium tabular-nums ${
                        settlement.refund_paise >= 0 ? "text-paid-800" : "text-overdue-800"
                      }`}>
                        {settlement.refund_paise >= 0
                          ? `${formatCurrency(settlement.refund_paise)} refunded`
                          : `${formatCurrency(Math.abs(settlement.refund_paise))} recovered`}
                      </p>
                    )}
                  </div>
                </div>

                {/* The stay's actions, as buttons in a row of their own. They
                    were 16px text links 12px apart in the header's corner, and
                    one of them settles a deposit, which cannot be undone (UX
                    audit, touch targets). Everyday actions sit on the left;
                    the two that end the stay sit apart on the right. */}
                {(active || !settlement) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 px-4 py-2">
                    {booked && (
                      <Button variant="secondary" size="sm" onClick={() => setAssigningStay(stay)}>
                        Assign bed
                      </Button>
                    )}
                    {active && (
                      <Button variant="secondary" size="sm" onClick={() => setRentStay(stay)}>
                        Change rent
                      </Button>
                    )}
                    {active && !booked && (
                      <Button variant="secondary" size="sm" onClick={() => setMovingStay(stay)}>
                        Move bed
                      </Button>
                    )}
                    {active && !booked && (
                      <Button variant="secondary" size="sm" onClick={() => setNoticeStay(stay)}>
                        {stay.notice_date || stay.expected_end_date ? "Update notice" : "Record notice"}
                      </Button>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {/* One way out. A stay that ended with the money left
                          for later still has a deposit to account for. */}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setSettlingStay(stay.id); setSettlingBooking(booked); }}
                      >
                        {booked ? "Cancel booking" : active ? "Move out" : "Settle the money"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* The ledger's own control: a real button, full width, a
                    chevron, and the payment count, so a closed ledger still
                    says whether there is anything in it. */}
                <button
                  type="button"
                  onClick={() => toggleStay(stay.id)}
                  aria-expanded={open}
                  aria-controls={ledgerId}
                  className="flex min-h-11 w-full items-center gap-2 border-t border-stone-100 px-4 py-2 text-left text-sm font-medium text-indigo-700 transition duration-150 ease-out last:rounded-b-xl hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                    className={`h-4 w-4 shrink-0 transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  {open ? "Hide ledger" : "Show ledger"}
                  <span className="ml-auto text-xs font-normal tabular-nums text-stone-500">
                    {stayPayments === undefined
                      ? "…"
                      : `${stayPayments.length} payment${stayPayments.length === 1 ? "" : "s"}`}
                  </span>
                </button>

                {/* Expanded: payment ledger */}
                {open && (
                  <div id={ledgerId} className="border-t border-stone-100 px-4 py-3">
                    {/* What the refund was made of. Kept on the page because
                        the tenant asks about it weeks later, and the owner
                        should not have to remember. */}
                    {settlement && (
                      <div className="mb-4 rounded-xl bg-stone-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                          Settlement · {settlement.created_at.slice(0, 10)}
                        </p>
                        <dl className="mt-2 space-y-1 text-sm">
                          <div className="flex justify-between gap-4">
                            <dt className="text-stone-600">Deposit held</dt>
                            <dd className="tabular-nums text-stone-800">
                              {formatCurrency(settlement.deposit_paise)}
                            </dd>
                          </div>
                          {/* Only terms of the sum get a line, so the
                              breakdown adds up to the refund below it. */}
                          {settlement.dues_paise > 0 && (
                            <div className="flex justify-between gap-4">
                              <dt className="text-stone-600">Rent outstanding</dt>
                              <dd className="tabular-nums text-stone-800">
                                −{formatCurrency(settlement.dues_paise)}
                              </dd>
                            </div>
                          )}
                          {settlement.dues_paise < 0 && (
                            <div className="flex justify-between gap-4">
                              <dt className="text-stone-600">
                                Rent refunded
                                {/* What was kept is the decision worth seeing
                                    again months later, so it goes on the record
                                    rather than being inferable from the sum. */}
                                <span className="block text-xs text-stone-400">
                                  of {formatCurrency(-settlement.dues_paise)} paid in advance
                                </span>
                              </dt>
                              <dd className="tabular-nums text-stone-800">
                                +{formatCurrency(settlement.advance_returned_paise)}
                              </dd>
                            </div>
                          )}
                          {(settlement.adjustments ?? []).map((a, i) => (
                            <div key={i} className="flex justify-between gap-4">
                              <dt className="text-stone-600">{a.label}</dt>
                              <dd className="tabular-nums text-stone-800">
                                {a.amount_paise < 0 ? "−" : "+"}
                                {formatCurrency(Math.abs(a.amount_paise))}
                              </dd>
                            </div>
                          ))}
                          <div className="flex justify-between gap-4 border-t border-stone-200 pt-1">
                            <dt className="font-semibold text-stone-700">
                              {settlement.refund_paise >= 0 ? "Refunded" : "Owed by tenant"}
                            </dt>
                            <dd className={`font-bold tabular-nums ${
                              settlement.refund_paise >= 0 ? "text-paid-800" : "text-overdue-800"
                            }`}>
                              {formatCurrency(Math.abs(settlement.refund_paise))}
                            </dd>
                          </div>
                        </dl>
                        {settlement.notes && (
                          <p className="mt-2 border-t border-stone-200 pt-2 text-xs text-stone-500">
                            {settlement.notes}
                          </p>
                        )}
                      </div>
                    )}

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
                              aria-label="Amount in rupees"
                              className="w-32"
                            />
                            {/* What it is for, beside how it arrived. A deposit
                                is held, not rent: it never reduces what they
                                owe, and it is what a settlement refunds. */}
                            <Select
                              value={payKind}
                              onChange={(e) => setPayKind(e.target.value as PaymentKind)}
                              aria-label="Payment is for"
                              className="w-auto"
                            >
                              <option value="rent">Rent</option>
                              <option value="deposit">Deposit</option>
                            </Select>
                            <SegmentedControl options={PAY_METHODS} value={payType} onChange={setPayType} ariaLabel="Paid by" />
                            <Input
                              type="date"
                              value={payDate}
                              max={latestPaymentDate()}
                              onChange={(e) => setPayDate(e.target.value)}
                              aria-label="Payment date"
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
                      paymentsFailed ? (
                        <FormError>Could not load the payments. Reload the page to try again.</FormError>
                      ) : (
                        <p className="text-xs text-stone-400">Loading…</p>
                      )
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
                              <td className="py-2 font-medium tabular-nums text-stone-800">
                                {formatCurrency(p.amount)}
                                {p.kind === "deposit" && <Badge tone="info" className="ml-2">Deposit</Badge>}
                                <span className="ml-2"><PaymentStatus payment={p} audience="owner" /></span>
                              </td>
                              <td className="py-2 text-stone-500">{payMethodLabel(p.payment_type)}</td>
                              <td className="py-2 text-stone-400">
                                {p.notes || "—"}
                                <RejectionReason payment={p} />
                              </td>
                              <td className="py-2 text-right">
                                {/* Delete-and-re-add is the only way to correct
                                    a payment, so this must be reachable on a
                                    phone, an iPad and a keyboard — see
                                    HOVER_REVEAL for how it once was not. */}
                                <button
                                  onClick={() => handleDeletePayment(stay.id, p.id)}
                                  aria-label={`Delete payment of ${formatCurrency(p.amount)} on ${p.payment_date.slice(0, 10)}`}
                                  className={`-my-1.5 inline-flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-lg text-stone-400 transition duration-150 ease-out hover:bg-red-50 hover:text-red-500 ${HOVER_REVEAL}`}
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

      {/* Last on the page and deliberately plain: removing a tenant is for
          test entries and duplicates, not for someone who moved out, and it
          should not sit beside the everyday actions. */}
      <section className="mt-10 border-t border-stone-200 pt-6">
        <h2 className="text-sm font-semibold text-stone-900">Delete tenant</h2>
        <p className="mt-1 max-w-prose text-sm text-stone-500">
          For a test entry or a duplicate. Removes them with every stay and payment,
          and cannot be undone. To record that someone left, end their stay instead.
        </p>
        <Button variant="secondary" className="mt-3 text-red-600 hover:text-red-700" onClick={handleDeleteTenant}>
          Delete tenant…
        </Button>
      </section>

      {token && (
        <RecordNoticeDialog
          open={noticeStay !== null}
          stay={noticeStay}
          token={token}
          tenantName={tenant?.name}
          onSaved={(updated) => {
            setStays((prev) => prev.map((s) => (s.id === updated.id ? withPlace(updated, s) : s)));
            setNoticeStay(null);
          }}
          onClose={() => setNoticeStay(null)}
        />
      )}

      {token && (
        <ChangeRentDialog
          open={rentStay !== null}
          stay={rentStay}
          token={token}
          tenantName={tenant?.name}
          onSaved={(updated) => {
            setStays((prev) => prev.map((s) => (s.id === updated.id ? withPlace(updated, s) : s)));
            setRentStay(null);
            loadSummary();
          }}
          onClose={() => setRentStay(null)}
        />
      )}

      {token && (
        <MoveBedDialog
          open={movingStay !== null}
          stay={movingStay}
          token={token}
          tenantName={tenant?.name}
          onMoved={() => {
            setMovingStay(null);
            // The response is the bare stay; the list names the new bed.
            reloadStays();
            loadSummary();
          }}
          onClose={() => setMovingStay(null)}
        />
      )}

      {token && tenant && (
        <NewStayDialog
          open={startingStay}
          tenantId={tenant.id}
          tenantName={tenant.name}
          token={token}
          onCreated={() => {
            setStartingStay(false);
            reloadStays();
            loadSummary();
          }}
          onClose={() => setStartingStay(false)}
        />
      )}

      {/* Moving out — the same sheet the grid opens, so a departure is
          dated and settled the same way from either place. */}
      {token && (
        <MoveOutSheet
          open={settlingStay !== null}
          booking={settlingBooking}
          stayId={settlingStay}
          token={token}
          tenantName={tenant?.name}
          onDone={({ settlement }) => {
            if (settlement) setSettlements((prev) => ({ ...prev, [settlement.stay_id]: settlement }));
            setSettlingStay(null);
            reloadStays();
            loadSummary();
          }}
          onClose={() => setSettlingStay(null)}
        />
      )}

      {token && (
        <PortalPasswordDialog
          open={settingPassword}
          tenant={tenant}
          token={token}
          onSaved={(updated) => { setTenant(updated); setSettingPassword(false); }}
          onClose={() => setSettingPassword(false)}
        />
      )}

      {/* Assign bed modal */}
      {assigningStay !== null && token && (
        <AssignBedModal
          stay={assigningStay}
          token={token}
          onAssigned={(paidSuffix, missed) => {
            // Refetched rather than patched: the bed just changed, and its
            // name comes only from the list.
            reloadStays();
            loadSummary();
            setAssigningStay(null);
            if (missed) toast.error(`Bed assigned. ${missed}`);
            else toast.success(`Bed assigned${paidSuffix}`);
          }}
          onClose={() => setAssigningStay(null)}
        />
      )}
    </div>
  );
}
