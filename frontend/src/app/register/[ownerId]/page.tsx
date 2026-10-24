"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { registrationApi, uploadApi, ApiError } from "@/lib/api";
import {
  Button, Card, Field, FileInput, FormError, Input, Textarea,
} from "@/components/ui";
import { checkPhones } from "@/lib/phone";

/**
 * The frame around the form.
 *
 * Every other screen in this app optimises for scan speed for someone who uses
 * it daily. This one optimises for trust from someone who has never seen it —
 * a prospective tenant pointing a phone at a sticker in a corridor, deciding
 * whether this is a real business or a scam. Hence the one place in the product
 * with a gradient, a wordmark and the display face doing real work.
 *
 * The character stays strictly out here. The form inside keeps the same boring,
 * legible controls as the rest of the app: this is where someone types their
 * Aadhaar number, and a clever input is a hostile input.
 */
function PublicFrame({
  ownerName,
  children,
}: {
  ownerName: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-stone-50 to-stone-50">
      <header className="px-4 pb-10 pt-12 text-center sm:pt-16">
        {/* The hostel speaking, as on a sticker at its own reception. The
            property name is the trust signal; the app's own name, once a
            line above it, meant nothing to someone who has never heard of
            it (Oct 2026). Until the name loads, or when there is no single
            property to name, it says "Welcome" alone rather than flashing a
            placeholder. */}
        <h1 className="text-balance font-display text-3xl font-bold text-stone-900 sm:text-4xl">
          {ownerName ? (
            <>
              Welcome to{" "}
              <span className="text-indigo-600">{ownerName}</span>
            </>
          ) : (
            "Welcome"
          )}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-stone-500">
          Fill in your details to get started.
        </p>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 pb-16 motion-safe:animate-[rise_.4s_ease-out]">
        {children}
      </main>
    </div>
  );
}

/**
 * A file upload with the filename echoed back.
 *
 * The confirmation matters more here than anywhere else in the app: this is
 * someone on a phone in a corridor picking a photo out of a camera roll, and
 * "did that attach?" has no other answer on the page. The name takes the hint
 * slot once a file is chosen, which is exactly what the pre-kit version did.
 *
 * `accept` is a prop because the photo field wants images only while the ID
 * fields also take a PDF — but there is deliberately no `capture` attribute on
 * either. Forcing the camera would break picking an existing photo out of the
 * gallery, and that flow was singled out as the part of this page that already
 * works well on a phone.
 */
function UploadField({
  label,
  file,
  onChange,
  hint,
  error,
  required,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
}: {
  label: React.ReactNode;
  file: File | null;
  onChange: (f: File | null) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  accept?: string;
}) {
  return (
    <Field
      label={label}
      required={required}
      error={error}
      hint={file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : hint}
    >
      <FileInput
        accept={accept}
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </Field>
  );
}

export default function RegisterPage({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = use(params);
  const ownerIdNum = parseInt(ownerId, 10);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [idProofFront, setIdProofFront] = useState<File | null>(null);
  const [idProofBack, setIdProofBack] = useState<File | null>(null);
  const [idFrontError, setIdFrontError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);

  // Declared above the isNaN guard below: hooks cannot sit after a conditional
  // return. A failure here costs the header its property name and nothing
  // else — the form still works, so it must not block or shout.
  useEffect(() => {
    if (isNaN(ownerIdNum)) return;
    let cancelled = false;
    registrationApi
      .owner(ownerIdNum)
      // An empty name means no single property to name.
      .then((o) => { if (!cancelled) setOwnerName(o.name || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ownerIdNum]);

  if (isNaN(ownerIdNum)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
        <p className="text-sm text-stone-500">Invalid registration link.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // The input's `required` normally stops the submit before this runs and
    // points at the field itself. This is the fallback for a browser that
    // skips native validation — checked before any upload starts, so nobody
    // waits through a photo upload to be told the ID is missing.
    if (!idProofFront) {
      setIdFrontError("Add a photo of the front of your ID.");
      return;
    }
    const phones = checkPhones(phone, emergencyPhone);
    if ("error" in phones) { setError(phones.error); return; }
    setLoading(true);
    try {
      let photoUrl: string | undefined;
      let idProofFrontUrl: string | undefined;
      let idProofBackUrl: string | undefined;
      if (photo) photoUrl = await uploadApi.publicUpload(photo);
      if (idProofFront) idProofFrontUrl = await uploadApi.publicUpload(idProofFront);
      if (idProofBack) idProofBackUrl = await uploadApi.publicUpload(idProofBack);

      await registrationApi.register(ownerIdNum, {
        name,
        phone: phones.phone,
        password,
        photo_url: photoUrl,
        id_proof_url: idProofFrontUrl,       // legacy fallback
        id_proof_front_url: idProofFrontUrl,
        id_proof_back_url: idProofBackUrl,
        address: address || undefined,
        emergency_contact_name: emergencyName || undefined,
        emergency_contact_phone: phones.emergency,
        workplace: workplace || undefined,
        aadhaar_number: aadhaarNumber || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <PublicFrame ownerName={ownerName}>
        <Card padding="none" className="p-8 text-center">
          {/* Indigo, not emerald: the status hues in globals.css are reserved
              for bed status, and a green tick here would be the first place in
              the app where one of them means something else. */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 ring-8 ring-indigo-50/60">
            <svg
              className="h-8 w-8 text-indigo-600 motion-safe:animate-[draw_.5s_ease-out_.15s_backwards]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2 className="mt-5 font-display text-2xl font-bold text-stone-900">
            You&apos;re registered
          </h2>
          <p className="mt-2 text-sm text-stone-500">
            {ownerName
              ? `Your details have gone to ${ownerName} for review.`
              : "Your details have gone to the owner for review."}
          </p>

          {/* What happens next, because "you'll be contacted" leaves someone
              who just typed their Aadhaar number with nothing to expect. */}
          <ol className="mt-6 space-y-3 text-left">
            {[
              "The owner checks your details.",
              "You'll hear from them on the number you gave.",
              "Then sign in with your phone number and password.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-stone-600">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-stone-100 text-xs font-semibold tabular-nums text-stone-500">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <Link
            href="/my/login"
            className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            Go to the tenant portal →
          </Link>
        </Card>
      </PublicFrame>
    );
  }

  // The same four groups, in the same order and with the same labels, as the
  // owner's Add tenant form, so what the owner reviews reads the way they
  // would have typed it. Only what is required is marked; "(optional)" beside
  // most fields read as permission to skip them, and every hint that did not
  // change what someone types is gone. The owner wants an emergency contact
  // from everyone and no email at all (Oct 2026).
  return (
    <PublicFrame ownerName={ownerName}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card title="You">
          <div className="space-y-4">
            <Field label="Full name" required>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Phone" required hint="You'll sign in with this.">
              <Input required type="tel" inputMode="tel" placeholder="10-digit number" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="About you">
          <div className="space-y-4">
            <Field label="Workplace / College">
              <Input value={workplace} onChange={(e) => setWorkplace(e.target.value)} />
            </Field>
            <Field label="Home address">
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="resize-none" />
            </Field>
          </div>
        </Card>

        <Card title="ID and emergency contact">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* The one hint kept for trust: this is a stranger typing an
                Aadhaar number into a page they reached from a sticker. */}
            <Field label="Aadhaar number" hint="Only the owner sees this." className="sm:col-span-2">
              <Input value={aadhaarNumber} onChange={(e) => setAadhaarNumber(e.target.value)} maxLength={12} inputMode="numeric" placeholder="12 digits" />
            </Field>
            <Field label="Emergency contact" required>
              <Input required value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="Parent / guardian" />
            </Field>
            <Field label="Their phone" required>
              <Input required type="tel" inputMode="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
            </Field>
            <UploadField
              label="ID front"
              required
              onChange={(f) => { setIdProofFront(f); if (f) setIdFrontError(""); }}
              file={idProofFront}
              error={idFrontError}
              hint="Aadhaar, passport or driving licence"
            />
            <UploadField label="ID back" onChange={setIdProofBack} file={idProofBack} />
            <UploadField
              label="Your photo"
              onChange={setPhoto}
              file={photo}
              accept="image/jpeg,image/png,image/webp"
            />
          </div>
        </Card>

        <Card title="Sign-in">
          <Field label="Password" required hint="At least 6 characters">
            <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </Card>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Submitting…" : "Submit registration"}
        </Button>
      </form>
    </PublicFrame>
  );
}
