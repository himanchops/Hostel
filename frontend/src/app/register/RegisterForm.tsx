"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { registrationApi, uploadApi, ApiError } from "@/lib/api";
import {
  Button, Card, Field, FileInput, FormError, Input, ShowPassword, Textarea,
} from "@/components/ui";
import { checkPhones, tenDigits } from "@/lib/phone";
import { publicMessage } from "@/lib/publicError";
import { HOUSE_RULES_VERSION } from "@/lib/houseRules";
import { HouseRulesSheet } from "@/components/HouseRules";

/**
 * An Aadhaar number is twelve digits, written with or without spaces. The
 * field once took anything; it now takes digits and spaces, and the form
 * checks there are twelve before anything uploads. It is kept as typed.
 */
function aadhaarError(value: string): string | null {
  if (!value.trim()) return null;
  return value.replace(/\D/g, "").length === 12 ? null : "An Aadhaar number has 12 digits.";
}

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
  subtitle = "Fill in your details to get started.",
  children,
}: {
  ownerName: string | null;
  subtitle?: string;
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
        <p className="mx-auto mt-3 max-w-md text-sm text-stone-500">{subtitle}</p>
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

/**
 * The registration form for one owner, behind both `/register/:ownerId` and
 * a bare `/register`. NaN, from a link with no usable owner in it, shows the
 * "link doesn't work" card instead of a form.
 */
export function RegisterForm({ ownerId: ownerIdNum }: { ownerId: number }) {
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
  // Each check's message sits under its own field, and the field takes the
  // focus, so the browser scrolls to the reason and not just the highlight.
  // A message near the button for a field 1,300px up was UX audit M15.
  const [fieldError, setFieldError] = useState<{ phone?: string; emergency?: string; aadhaar?: string }>({});
  const phoneRef = useRef<HTMLInputElement>(null);
  const emergencyRef = useRef<HTMLInputElement>(null);
  const aadhaarRef = useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = useState(false);
  // A wrong link used to show the whole form and fail only on submit, after
  // three photo uploads. "bad" replaces the form; a network failure leaves
  // it up, because the link may well be fine.
  const [link, setLink] = useState<"checking" | "ok" | "bad">("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [uploadState, setUploadState] = useState<"uploading" | "done" | "failed">("uploading");
  // One upload per file chosen, however often the rules sheet opens: going
  // back to fix a phone number must not send three photos again. A failed
  // upload is forgotten, so the next attempt tries it afresh.
  const uploads = useRef(new Map<File, Promise<string>>());
  const uploadRun = useRef(0);

  // Declared above the isNaN guard below: hooks cannot sit after a conditional
  // return. A failure here costs the header its property name and nothing
  // else — the form still works, so it must not block or shout.
  useEffect(() => {
    if (isNaN(ownerIdNum)) return;
    let cancelled = false;
    registrationApi
      .owner(ownerIdNum)
      // An empty name means no single property to name.
      .then((o) => { if (!cancelled) { setOwnerName(o.name || null); setLink("ok"); } })
      .catch((err) => {
        if (cancelled) return;
        setLink(err instanceof ApiError && err.status === 404 ? "bad" : "ok");
      });
    return () => { cancelled = true; };
  }, [ownerIdNum]);

  if (isNaN(ownerIdNum) || link === "bad") {
    return (
      <PublicFrame ownerName={null} subtitle="This registration link doesn't work.">
        <Card padding="none" className="p-6 text-center text-sm text-stone-600">
          Ask the hostel for their QR code again, or check the link you were sent.
        </Card>
      </PublicFrame>
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
    const aadhaar = aadhaarError(aadhaarNumber);
    if ("error" in phones || aadhaar) {
      const phoneWrong = !tenDigits(phone);
      const next = {
        phone: phoneWrong && "error" in phones ? phones.error : undefined,
        emergency: !phoneWrong && "error" in phones ? phones.error : undefined,
        aadhaar: aadhaar ?? undefined,
      };
      setFieldError(next);
      (next.phone ? phoneRef : next.aadhaar ? aadhaarRef : emergencyRef).current?.focus();
      return;
    }
    setFieldError({});
    // The rules come next, and the photos start uploading behind them: the
    // uploads were the slow part of submitting, and reading covers them.
    startUploads();
    setRulesOpen(true);
  }

  function uploadOnce(file: File): Promise<string> {
    let p = uploads.current.get(file);
    if (!p) {
      p = uploadApi.publicUpload(file);
      uploads.current.set(file, p);
      p.catch(() => uploads.current.delete(file));
    }
    return p;
  }

  /** Photo, ID front, ID back — each upload started once and shared. */
  function startUploads() {
    const run = ++uploadRun.current;
    const all = Promise.all(
      [photo, idProofFront, idProofBack].map((f) => (f ? uploadOnce(f) : Promise.resolve(undefined))),
    );
    setUploadState("uploading");
    // Only the latest run reports, so an older one finishing late cannot
    // overwrite a newer state. The catch is also what keeps a failure here
    // from being an unhandled rejection; agreeing awaits it and shows it.
    all.then(
      () => { if (run === uploadRun.current) setUploadState("done"); },
      () => { if (run === uploadRun.current) setUploadState("failed"); },
    );
    return all;
  }

  async function register() {
    // Checked already on the way in; the form sits under the sheet and
    // cannot have changed since. This only narrows the type.
    const phones = checkPhones(phone, emergencyPhone);
    if ("error" in phones) {
      setError(phones.error);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const [photoUrl, idProofFrontUrl, idProofBackUrl] = await startUploads();

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
        rules_version: HOUSE_RULES_VERSION,
      });
      setRulesOpen(false);
      setSubmitted(true);
    } catch (err) {
      setError(publicMessage(err));
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
              who just typed their Aadhaar number with nothing to expect. It
              once ended "then sign in with your phone number and password",
              which most tenants never need to do (owner, Oct 2026). */}
          <ol className="mt-6 space-y-3 text-left">
            {[
              "The owner checks your details.",
              "They give you a room and a bed, and you move in.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-stone-600">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-stone-100 text-xs font-semibold tabular-nums text-stone-500">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <p className="mt-6 text-left text-sm text-stone-500">
            That&apos;s all you need to do. If you ever want to send a payment
            screenshot or give notice, sign in with your phone number and password.
          </p>
          <Link
            href="/my/login"
            className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:underline"
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
            <Field label="Phone" required hint="You'll sign in with this." error={fieldError.phone}>
              <Input ref={phoneRef} required type="tel" inputMode="tel" placeholder="10-digit number" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
            <Field label="Aadhaar number" hint="Only the owner sees this." className="sm:col-span-2" error={fieldError.aadhaar}>
              <Input
                ref={aadhaarRef}
                value={aadhaarNumber}
                // Digits and spaces only, so "1234 5678 9012" fits and a
                // letter never lands.
                onChange={(e) => setAadhaarNumber(e.target.value.replace(/[^\d ]/g, ""))}
                maxLength={14}
                inputMode="numeric"
                placeholder="12 digits"
              />
            </Field>
            <Field label="Emergency contact" required>
              <Input required value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="Parent / guardian" />
            </Field>
            <Field label="Their phone" required error={fieldError.emergency}>
              <Input ref={emergencyRef} required type="tel" inputMode="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
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
            <Input required type={reveal ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ShowPassword checked={reveal} onChange={setReveal} />
        </Card>

        {error && <FormError>{error}</FormError>}

        <Button type="submit" className="w-full">
          Submit registration
        </Button>
      </form>
      <HouseRulesSheet
        open={rulesOpen}
        version={HOUSE_RULES_VERSION}
        onClose={() => setRulesOpen(false)}
        onAgree={register}
        busy={loading}
        uploads={uploadState}
        error={error}
      />
    </PublicFrame>
  );
}
