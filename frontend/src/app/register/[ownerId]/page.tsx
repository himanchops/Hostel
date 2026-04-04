"use client";

import { useState } from "react";
import { use } from "react";
import { registrationApi, uploadApi, ApiError } from "@/lib/api";

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const fileCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700";
const optionalSpan = <span className="text-gray-400 font-normal">(optional)</span>;

function FileInput({ label, onChange, file, hint }: { label: React.ReactNode; onChange: (f: File | null) => void; file: File | null; hint?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className={fileCls}
      />
      {file && <p className="mt-1 text-xs text-gray-400">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
      {hint && !file && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
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

  if (isNaN(ownerIdNum)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <p className="text-sm text-gray-500">Invalid registration link.</p>
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Registration submitted!</h2>
          <p className="mt-2 text-sm text-gray-500">
            Your details have been sent to the owner for review. You'll be contacted once approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Tenant Registration</h1>
          <p className="mt-2 text-sm text-gray-500">
            Fill in your details to register. The owner will review and approve your request.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* ── Personal details ── */}
            <div>
              <label className={labelCls}>Full name <span className="text-red-500">*</span></label>
              <input required type="text" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Phone <span className="text-red-500">*</span></label>
                <input required type="tel" placeholder="10-digit number" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email {optionalSpan}</label>
                <input type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Home address {optionalSpan}</label>
              <textarea
                placeholder="Full home / permanent address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                className={inputCls + " resize-none"}
              />
            </div>

            <div>
              <label className={labelCls}>Workplace / College {optionalSpan}</label>
              <input type="text" placeholder="Company or college name" value={workplace} onChange={(e) => setWorkplace(e.target.value)} className={inputCls} />
            </div>

            {/* ── Emergency contact ── */}
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-700">Emergency contact {optionalSpan}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Name</label>
                  <input type="text" placeholder="Parent / guardian name" value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="tel" placeholder="Contact number" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} />
                </div>
              </div>
            </div>

            {/* ── ID details ── */}
            <div>
              <label className={labelCls}>Aadhaar number {optionalSpan}</label>
              <input type="text" placeholder="12-digit Aadhaar number" value={aadhaarNumber} onChange={(e) => setAadhaarNumber(e.target.value)} maxLength={12} className={inputCls} />
              <p className="mt-1 text-xs text-gray-400">Your Aadhaar number is stored securely and only visible to the property owner.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FileInput
                label={<>ID proof — front {optionalSpan}</>}
                onChange={setIdProofFront}
                file={idProofFront}
                hint="Aadhaar, passport, driving licence…"
              />
              <FileInput
                label={<>ID proof — back {optionalSpan}</>}
                onChange={setIdProofBack}
                file={idProofBack}
              />
            </div>

            {/* ── Portal password ── */}
            <div>
              <label className={labelCls}>Password <span className="text-red-500">*</span></label>
              <input required type="password" placeholder="Min. 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              <p className="mt-1 text-xs text-gray-400">You'll use this to log in to your tenant portal after approval.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {loading ? "Submitting…" : "Submit registration"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
