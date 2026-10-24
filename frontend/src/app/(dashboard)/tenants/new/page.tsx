"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, staysApi, uploadApi, TenantUpdateData, ApiError, formatDay, today } from "@/lib/api";
import {
  Button,
  Card,
  Field,
  FileInput,
  FormError,
  Input,
  PageHeader,
  SegmentedControl,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  BedPicker, VacantBed,
  StayTermsFields, StayTerms, emptyStayTerms, stayTermsPayload, stayTermsError,
  PaidTodayFields, PaidToBookFields, PaidToday, PaidSuggestion, emptyPaidToday,
  suggestedFromTerms, NOTHING_SUGGESTED, paidTodayDate,
  paidTodayError, paidTodaySuffix, recordPaidToday,
  Arrival, arrivalOptions, ARRIVAL_HINT,
} from "@/components/StayForm";
import { checkPhones } from "@/lib/phone";

const ARRIVALS = arrivalOptions("Just add");

export default function NewTenantPage() {
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Moving in is the default: it is most of what happens at the desk. It was
  // once an opt-in checkbox, because the only alternative to "no bed yet" was
  // forcing one; booking is now its own answer.
  const [arrival, setArrival] = useState<Arrival>("now");
  const [bed, setBed] = useState<VacantBed | null>(null);
  const [terms, setTerms] = useState<StayTerms>(emptyStayTerms());
  const [paid, setPaid] = useState<PaidToday>(emptyPaidToday());

  // Switching between moving in and booking starts the money over: the two
  // suggest different amounts, and a figure typed for one is not the other's.
  function chooseArrival(next: Arrival) {
    setArrival(next);
    setPaid(emptyPaidToday());
    setError("");
  }

  const suggested: PaidSuggestion = arrival === "booking" ? NOTHING_SUGGESTED : suggestedFromTerms(terms);
  const paidDate = arrival === "booking" ? today() : paidTodayDate(terms);
  const suffix = arrival === "later" ? "" : paidTodaySuffix(paid, suggested);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");

    const phones = checkPhones(phone, emergencyPhone);
    if ("error" in phones) { setError(phones.error); return; }

    // Checked before the tenant is created, not after: a rent typo should not
    // cost the owner a half-made record they then have to finish by hand.
    if (arrival === "now" && !bed) {
      setError("Pick a bed, or choose “Booking” or “Just add”.");
      return;
    }
    if (arrival !== "later") {
      const invalid = stayTermsError(terms) || paidTodayError(paid, suggested);
      if (invalid) { setError(invalid); return; }
    }

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
        email: email || undefined,
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

      const tenant = await tenantsApi.create(token, data);

      // The tenant exists from here on, so nothing below may throw the whole
      // submission away. A stay that fails to create leaves a real person on
      // record with nowhere to sleep, and the honest thing is to say so and
      // hand them the page — the same shape as the backend's "tenant approved
      // but failed to create stay".
      if (arrival !== "later") {
        try {
          const stay = await staysApi.create(token, {
            tenant_id: tenant.id,
            ...(arrival === "now" && bed ? { bed_id: bed.id } : {}),
            ...stayTermsPayload(terms),
          });
          const done = arrival === "now" && bed
            ? `${tenant.name} added and placed in ${bed.roomName} · ${bed.name}`
            : `${tenant.name} booked from ${formatDay(terms.startDate)}`;
          const missed = await recordPaidToday(token, stay.id, paid, suggested, paidDate);
          if (missed) toast.error(`${done}. ${missed}`);
          else toast.success(done + suffix);
        } catch (stayErr) {
          const what = arrival === "now" ? "the bed was not assigned" : "the booking was not saved";
          toast.error(
            stayErr instanceof ApiError
              ? `${tenant.name} was added, but ${what}: ${stayErr.message}`
              : `${tenant.name} was added, but ${what}.`,
          );
        }
      } else {
        // ToastProvider lives in the dashboard layout, so this survives the
        // navigation and lands on the tenant's page.
        toast.success(`${tenant.name} added`);
      }
      router.push(`/tenants/${tenant.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tenant");
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = arrival === "now" ? `Add and move in${suffix}`
    : arrival === "booking" ? `Add booking${suffix}`
    : "Add tenant";

  // Who they are first, in full, then their stay and the money last, beside
  // the button that saves it. The details were briefly folded away to shorten
  // the form; the owner wants them filled in every time, and a folded panel
  // invites skipping them (Oct 2026). It is short instead by pairing fields
  // on the iPad, a bed dropdown and a cycle switch.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Add new tenant"
        breadcrumb={[{ label: "Tenants", href: "/tenants" }, { label: "New tenant" }]}
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        <Card title="Who">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" />
            </Field>
            <Field label="Phone" required>
              <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 9876543210" />
            </Field>
          </div>
        </Card>

        <Card title="About them">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Workplace / College">
              <Input value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="e.g. BITS Pilani" />
            </Field>
            <Field label="Home address" className="sm:col-span-2">
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="resize-none" placeholder="Permanent home address" />
            </Field>
            <Field label="Notes" hint="Only you see this. Tenants never do." className="sm:col-span-2">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering: who referred them, how long they're staying, a deposit still to come" />
            </Field>
          </div>
        </Card>

        <Card title="ID and emergency contact">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Aadhaar number">
              <Input value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} maxLength={12} inputMode="numeric" placeholder="12-digit number" />
            </Field>
            <Field label="Emergency contact">
              <Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="Parent / guardian" />
            </Field>
            <Field label="Their phone">
              <Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="Phone number" />
            </Field>
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
        </Card>

        <Card title="Their stay">
          <SegmentedControl options={ARRIVALS} value={arrival} onChange={chooseArrival} ariaLabel="Their stay" />
          <p className="mt-2 text-[13px] text-stone-500">{ARRIVAL_HINT[arrival]}</p>

          {arrival !== "later" && token && (
            <div className="mt-4 space-y-4 border-t border-stone-100 pt-4">
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
        </Card>

        {error && <FormError>{error}</FormError>}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : submitLabel}
          </Button>
          <Link href="/tenants" className="inline-flex items-center rounded-lg px-4 py-2 text-sm text-stone-500 transition duration-150 ease-out hover:bg-stone-100">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
