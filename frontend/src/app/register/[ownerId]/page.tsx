"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { registrationApi, uploadApi, ApiError } from "@/lib/api";
import {
  Button, Card, Field, FileInput, FormError, Input, Textarea,
} from "@/components/ui";

const optionalSpan = <span className="font-normal text-stone-400">(optional)</span>;

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
        <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Hostel Manager
        </p>
        {/* The property name is the trust signal. Until it loads, the heading
            says something true rather than flashing a placeholder name. */}
        <h1 className="mt-3 text-balance font-display text-3xl font-bold text-stone-900 sm:text-4xl">
          {ownerName ? (
            <>
              Register with{" "}
              <span className="text-indigo-600">{ownerName}</span>
            </>
          ) : (
            "Tenant registration"
          )}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-stone-500">
          Fill in your details and the owner will review your request. It takes
          about two minutes.
        </p>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 pb-16 motion-safe:animate-[rise_.4s_ease-out]">
        {children}
      </main>
    </div>
  );
}

/**
 * ID upload with the filename echoed back.
 *
 * The confirmation matters more here than anywhere else in the app: this is
 * someone on a phone in a corridor picking a photo out of a camera roll, and
 * "did that attach?" has no other answer on the page. The name takes the hint
 * slot once a file is chosen, which is exactly what the pre-kit version did.
 */
function IdProofField({
  label,
  file,
  onChange,
  hint,
}: {
  label: React.ReactNode;
  file: File | null;
  onChange: (f: File | null) => void;
  hint?: string;
}) {
  return (
    <Field
      label={label}
      hint={file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : hint}
    >
      <FileInput
        accept="image/jpeg,image/png,image/webp,application/pdf"
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [idProofFront, setIdProofFront] = useState<File | null>(null);
  const [idProofBack, setIdProofBack] = useState<File | null>(null);
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
      .then((o) => { if (!cancelled) setOwnerName(o.name); })
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
    setLoading(true);
    try {
      let idProofFrontUrl: string | undefined;
      let idProofBackUrl: string | undefined;
      if (idProofFront) idProofFrontUrl = await uploadApi.publicUpload(idProofFront);
      if (idProofBack) idProofBackUrl = await uploadApi.publicUpload(idProofBack);

      await registrationApi.register(ownerIdNum, {
        name,
        phone,
        email: email || undefined,
        password,
        id_proof_url: idProofFrontUrl,       // legacy fallback
        id_proof_front_url: idProofFrontUrl,
        id_proof_back_url: idProofBackUrl,
        address: address || undefined,
        emergency_contact_name: emergencyName || undefined,
        emergency_contact_phone: emergencyPhone || undefined,
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
              "The owner checks your details and assigns you a bed.",
              "You'll hear from them on the phone number you gave.",
              "Once approved, sign in to see your rent and payments.",
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

  return (
    <PublicFrame ownerName={ownerName}>
      {/* padding="none" plus explicit padding: passing p-8 alongside Card's
          own p-4 would leave Tailwind's source order to pick the winner. */}
      <Card padding="none" className="p-6 sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <FormError>{error}</FormError>}

          {/* ── Personal details ── */}
          <Field label="Full name" required>
            <Input
              required
              type="text"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Phone" required>
              <Input
                required
                type="tel"
                placeholder="10-digit number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label={<>Email {optionalSpan}</>}>
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>

          <Field label={<>Home address {optionalSpan}</>}>
            <Textarea
              placeholder="Full home / permanent address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </Field>

          <Field label={<>Workplace / College {optionalSpan}</>}>
            <Input
              type="text"
              placeholder="Company or college name"
              value={workplace}
              onChange={(e) => setWorkplace(e.target.value)}
            />
          </Field>

          {/* ── Emergency contact ── */}
          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700">
              Emergency contact {optionalSpan}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  type="text"
                  placeholder="Parent / guardian name"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <Input
                  type="tel"
                  placeholder="Contact number"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {/* ── ID details ── */}
          <Field
            label={<>Aadhaar number {optionalSpan}</>}
            hint="Your Aadhaar number is stored securely and only visible to the property owner."
          >
            <Input
              type="text"
              placeholder="12-digit Aadhaar number"
              value={aadhaarNumber}
              onChange={(e) => setAadhaarNumber(e.target.value)}
              maxLength={12}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <IdProofField
              label={<>ID proof — front {optionalSpan}</>}
              onChange={setIdProofFront}
              file={idProofFront}
              hint="Aadhaar, passport, driving licence…"
            />
            <IdProofField
              label={<>ID proof — back {optionalSpan}</>}
              onChange={setIdProofBack}
              file={idProofBack}
            />
          </div>

          {/* ── Portal password ── */}
          <Field
            label="Password"
            required
            hint="You'll use this to log in to your tenant portal after approval."
          >
            <Input
              required
              type="password"
              placeholder="Min. 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" loading={loading} className="mt-2 w-full">
            {loading ? "Submitting…" : "Submit registration"}
          </Button>
        </form>
      </Card>
    </PublicFrame>
  );
}
