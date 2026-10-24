"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import {
  tenantsApi,
  staysApi,
  pendingPaymentsApi,
  Tenant,
  PendingPayment,
  ApiError,
  formatCurrency,
  formatDay,
  maskAadhaar,
  today,
} from "@/lib/api";
import {
  Banner,
  Button,
  Card,
  CountBadge,
  Drawer,
  EmptyState,
  Field,
  FormError,
  InboxIcon,
  ReceiptIcon,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useConfirm,
  useToast,
  TOUCH_TARGET,
  Modal,
  Textarea,
} from "@/components/ui";
import {
  BedPicker, VacantBed,
  StayTermsFields, StayTerms, emptyStayTerms, stayTermsPayload, stayTermsError,
  PaidTodayFields, PaidToBookFields, PaidToday, PaidSuggestion, emptyPaidToday,
  suggestedFromTerms, NOTHING_SUGGESTED, paidTodayDate,
  paidTodayError, paidTodaySuffix, recordPaidToday,
  Arrival, arrivalOptions, ARRIVAL_HINT,
} from "@/components/StayForm";

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

// ── Review and approve, on one screen ───────────────────────────────────────

const ARRIVALS = arrivalOptions("Just approve");

/** Digits only, the last ten: "+91 98450 11001" and "9845011001" are one number. */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Who they said they are, then their stay and the money last, beside the
 * button that saves it — the shape of Add tenant, with the same three answers
 * and the same fields. It was two steps (read, then "What would you like to
 * do?" over three radio cards) with its own site and bed dropdowns, and it
 * made the stay through the approve endpoint rather than the one Add tenant
 * uses (Oct 2026).
 */
function ReviewDrawer({
  tenant, token, sameNumber, onDone, onReject, onClose, rejectingId,
}: {
  tenant: Tenant;
  token: string;
  /** Tenants already on the books with this phone number. */
  sameNumber: Tenant[];
  /** `failed` when something after approving did not go through. */
  onDone: (approved: Tenant, message: string, failed: boolean) => void;
  onReject: (id: number) => void;
  onClose: () => void;
  rejectingId: number | null;
}) {
  const [arrival, setArrival] = useState<Arrival>("now");
  const [bed, setBed] = useState<VacantBed | null>(null);
  const [terms, setTerms] = useState<StayTerms>(emptyStayTerms());
  const [paid, setPaid] = useState<PaidToday>(emptyPaidToday());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // As on Add tenant: moving in suggests the rent and deposit from the terms,
  // a booking suggests nothing and is dated today.
  const suggested: PaidSuggestion = arrival === "booking" ? NOTHING_SUGGESTED : suggestedFromTerms(terms);
  const paidDate = arrival === "booking" ? today() : paidTodayDate(terms);
  const suffix = arrival === "later" ? "" : paidTodaySuffix(paid, suggested);

  function chooseArrival(next: Arrival) {
    setArrival(next);
    setPaid(emptyPaidToday());
    setError("");
  }

  const idFront = tenant.id_proof_front_url ?? tenant.id_proof_url;
  const idBack = tenant.id_proof_back_url;
  const isImage = (url: string) => /\.(jpe?g|png|webp)(\?|$)/i.test(url);

  async function handleApprove() {
    setError("");
    // Checked before approving, so a rent typo does not leave someone on the
    // books with no stay to finish by hand.
    if (arrival === "now" && !bed) {
      setError("Pick a bed, or choose “Booking” or “Just approve”.");
      return;
    }
    if (arrival !== "later") {
      const invalid = stayTermsError(terms) || paidTodayError(paid, suggested);
      if (invalid) { setError(invalid); return; }
    }

    setLoading(true);
    let approved: Tenant;
    try {
      approved = await tenantsApi.approve(token, tenant.id, { notes: notes.trim() || undefined });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve");
      setLoading(false);
      return;
    }

    // They are on the books from here on, so nothing below may undo that or
    // throw it away: say what did not happen, the way Add tenant does.
    if (arrival === "later") {
      onDone(approved, `${approved.name} approved`, false);
      return;
    }
    try {
      const stay = await staysApi.create(token, {
        tenant_id: approved.id,
        ...(arrival === "now" && bed ? { bed_id: bed.id } : {}),
        ...stayTermsPayload(terms),
      });
      const done = arrival === "now" && bed
        ? `${approved.name} approved and placed in ${bed.roomName} · ${bed.name}`
        : `${approved.name} approved, booked from ${formatDay(terms.startDate)}`;
      const missed = await recordPaidToday(token, stay.id, paid, suggested, paidDate);
      onDone(approved, missed ? `${done}. ${missed}` : done + suffix, !!missed);
    } catch (stayErr) {
      const what = arrival === "now" ? "the bed was not assigned" : "the booking was not saved";
      onDone(
        approved,
        stayErr instanceof ApiError
          ? `${approved.name} was approved, but ${what}: ${stayErr.message}`
          : `${approved.name} was approved, but ${what}.`,
        true,
      );
    }
  }

  const submitLabel = arrival === "now" ? `Approve & move in${suffix}`
    : arrival === "booking" ? `Approve & book${suffix}`
    : "Approve";

  const header = (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-700">Registration</h2>
  );

  const footer = (
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={loading}
          loading={rejectingId === tenant.id}
          onClick={() => onReject(tenant.id)}
        >
          {rejectingId === tenant.id ? "Removing…" : "Reject"}
        </Button>
        <Button className="flex-1" loading={loading} onClick={handleApprove}>
          {loading ? "Approving…" : submitLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <Drawer open onClose={onClose} header={header} footer={footer}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={tenant.name} photoUrl={tenant.photo_url} size="lg" />
          <div>
            <p className="text-lg font-bold text-stone-900">{tenant.name}</p>
            <p className="text-sm tabular-nums text-stone-500">{tenant.phone}</p>
            {tenant.email && <p className="text-sm text-stone-400">{tenant.email}</p>}
          </div>
        </div>

        {/* Someone already on the books scanning the sticker — for a portal
            login, say — would otherwise become a second record of the same
            person, with their history on the first. A warning, not a block:
            two people can share a phone. */}
        {sameNumber.map((t) => (
          <Banner key={t.id} tone="warning" href={`/tenants/${t.id}`}>
            <span>
              Same number as <strong>{t.name}</strong>, already on your books.
              If it&apos;s them, reject this and use their record.
            </span>
          </Banner>
        ))}

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

        <Field label="Notes" hint="Only you see this. Tenants never do.">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering: who referred them, how long they're staying" />
        </Field>

        <section aria-label="Their stay" className="border-t border-stone-100 pt-5">
          <h3 className="mb-3 text-base font-semibold text-stone-900">Their stay</h3>
          <SegmentedControl options={ARRIVALS} value={arrival} onChange={chooseArrival} ariaLabel="Their stay" />
          <p className="mt-2 text-[13px] text-stone-500">{ARRIVAL_HINT[arrival]}</p>

          {arrival !== "later" && (
            <div className="mt-4 space-y-4">
              {arrival === "now" && <BedPicker token={token} value={bed} onChange={setBed} />}
              <StayTermsFields
                value={terms}
                onChange={setTerms}
                layout="grid"
                startLabel={arrival === "booking" ? "Arriving on" : "Start date"}
              />
              {arrival === "now" ? (
                <PaidTodayFields
                  value={paid}
                  onChange={setPaid}
                  suggested={suggested}
                  date={paidDate}
                  cycle={terms.cycle}
                />
              ) : (
                <PaidToBookFields value={paid} onChange={setPaid} cycle={terms.cycle} />
              )}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// useSearchParams needs a Suspense boundary, or the build bails out of
// prerendering the page.
export default function PendingPage() {
  return (
    <Suspense>
      <PendingQueue />
    </Suspense>
  );
}

function PendingQueue() {
  const { token, owner } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  // Payments and the dashboard link straight to the proofs with ?tab=payments.
  const params = useSearchParams();
  const [tab, setTab] = useState<"registrations" | "payments">(() =>
    params.get("tab") === "payments" ? "payments" : "registrations",
  );

  const [pending, setPending] = useState<Tenant[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [onBooks, setOnBooks] = useState<Tenant[]>([]);
  const [drawerTenant, setDrawerTenant] = useState<Tenant | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [payLoading, setPayLoading] = useState(true);
  const [actioningPayId, setActioningPayId] = useState<number | null>(null);
  const [rejectingProof, setRejectingProof] = useState<PendingPayment | null>(null);

  const registrationUrl = typeof window !== "undefined" ? `${window.location.origin}/register/${owner?.id}` : "";

  const loadRegistrations = useCallback(() => {
    if (!token) return;
    // Everyone already on the books comes too, to catch a registration from
    // a phone number the owner already has.
    Promise.all([tenantsApi.list(token, true), tenantsApi.list(token)])
      .then(([waiting, approved]) => { setPending(waiting); setOnBooks(approved); })
      .catch(() => toast.error("Could not load registrations — reload the page"))
      .finally(() => setRegLoading(false));
  }, [token, toast]);

  const sameNumber = (t: Tenant) => onBooks.filter((o) => phoneKey(o.phone) === phoneKey(t.phone));

  const loadPayments = useCallback(() => {
    if (!token) return;
    pendingPaymentsApi.list(token)
      .then(setPendingPayments)
      .catch(() => toast.error("Could not load payment proofs — reload the page"))
      .finally(() => setPayLoading(false));
  }, [token, toast]);

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
      toast.success("Registration removed");
    } catch {
      toast.error("Failed to remove the registration");
    } finally { setRejectingId(null); }
  }

  function handleApproved(approved: Tenant, message: string, failed: boolean) {
    setPending((prev) => prev.filter((t) => t.id !== approved.id));
    setDrawerTenant(null);
    setOnBooks((prev) => [...prev, approved]);
    if (failed) toast.error(message);
    else toast.success(message);
  }

  async function handleApprovePayment(id: number) {
    if (!token) return;
    setActioningPayId(id);
    try {
      await pendingPaymentsApi.approve(token, id);
      setPendingPayments((prev) => prev.filter((p) => p.id !== id));
      toast.success("Payment approved");
    } catch {
      toast.error("Failed to approve the payment");
    } finally { setActioningPayId(null); }
  }

  // Rejecting keeps the submission and tells the tenant why (UX audit M6).
  // It used to delete the row, and the tenant's claim to have paid vanished
  // from their ledger without a word.
  function handleRejected(id: number) {
    setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    setRejectingProof(null);
    toast.success("Marked not accepted — the tenant will see it on their ledger");
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Pending" subtitle="Review registrations and payment submissions." />

      <div className="mb-6 flex w-fit gap-1 rounded-xl bg-stone-100 p-1">
        {(["registrations", "payments"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`${TOUCH_TARGET} flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition duration-150 ease-out ${
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
              <Button
                size="sm"
                onClick={async () => {
                  // writeText rejects on a denied permission or an unfocused
                  // document, so the toast has to wait for it — otherwise it
                  // claims success on a copy that never happened.
                  try {
                    await navigator.clipboard.writeText(registrationUrl);
                    toast.success("Registration link copied");
                  } catch {
                    toast.error("Couldn't copy — select the link and copy it manually");
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>

          {regLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : pending.length === 0 ? (
            <EmptyState
              icon={<InboxIcon className="h-8 w-8" />}
              title="Nothing waiting"
              message="Registrations from your link land here for approval."
            />
          ) : (
            <div className="space-y-3">
              {pending.map((t) => (
                <Card
                  key={t.id}
                  padding="none"
                  className="transition duration-150 ease-out hover:ring-indigo-200"
                >
                  <div className="flex flex-wrap items-center gap-3 px-4 py-4">
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
                          {sameNumber(t).length > 0 && (
                            <span className="text-xs font-medium text-amber-700">Same number as {sameNumber(t)[0].name}</span>
                          )}
                          <span className="text-xs text-stone-300">
                            {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Quick actions */}
                    <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
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
            <EmptyState
              icon={<ReceiptIcon className="h-8 w-8" />}
              title="No payment proofs"
              message="Screenshots submitted from the tenant portal appear here."
            />
          ) : (
            <div className="space-y-3">
              {pendingPayments.map((p) => (
                <Card key={p.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                    <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={actioningPayId === p.id}
                        onClick={() => setRejectingProof(p)}
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
          sameNumber={sameNumber(drawerTenant)}
          onDone={handleApproved}
          onReject={handleReject}
          onClose={() => setDrawerTenant(null)}
          rejectingId={rejectingId}
        />
      )}

      {token && (
        <RejectProofDialog
          proof={rejectingProof}
          token={token}
          onRejected={handleRejected}
          onClose={() => setRejectingProof(null)}
        />
      )}
    </div>
  );
}

/**
 * "Not accepted", with a reason the tenant reads on their own ledger. The
 * reason is optional because "I never received this" is sometimes the whole
 * story — but a blank rejection is what the audit's testers found hardest to
 * act on, so the box asks for one.
 */
function RejectProofDialog({
  proof, token, onRejected, onClose,
}: {
  proof: PendingPayment | null;
  token: string;
  onRejected: (id: number) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReason("");
    setError("");
  }, [proof]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!proof) return;
    setError("");
    setSaving(true);
    try {
      await pendingPaymentsApi.reject(token, proof.id, reason.trim());
      onRejected(proof.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject the payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={proof !== null}
      onClose={onClose}
      title="Not accepting this payment?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" type="submit" form="reject-proof" loading={saving}>
            Mark not accepted
          </Button>
        </>
      }
    >
      {proof && (
        <form id="reject-proof" onSubmit={submit} className="space-y-3">
          <p className="text-sm text-stone-600">
            {proof.tenant_name}&apos;s {formatCurrency(proof.amount)} stays on their ledger as
            {" "}<span className="font-medium text-stone-800">Not accepted</span>, with your reason.
            It is not counted as paid. They can submit it again.
          </p>
          <Field label="Reason" hint="Shown to the tenant. Optional, but it saves a phone call.">
            <Textarea
              rows={2}
              maxLength={300}
              placeholder="e.g. No UPI payment of this amount arrived on that day"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
            />
          </Field>
          {error && <FormError>{error}</FormError>}
        </form>
      )}
    </Modal>
  );
}
