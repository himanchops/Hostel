"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, uploadApi, TenantUpdateData, ApiError } from "@/lib/api";

const inputCls = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200";
const labelCls = "mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide";
const fileCls = "w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-700 outline-none focus:border-indigo-400";

export default function NewTenantPage() {
  const { token } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
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

      const tenant = await tenantsApi.create(token, data);
      router.push(`/tenants/${tenant.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tenant");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/tenants" className="hover:text-indigo-600">Tenants</Link>
        <span>/</span>
        <span className="text-gray-800">New tenant</span>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-gray-900">Add new tenant</h1>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* Basic info */}
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Basic information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full name <span className="text-red-500">*</span></label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Rahul Sharma" />
            </div>
            <div>
              <label className={labelCls}>Phone <span className="text-red-500">*</span></label>
              <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="e.g. 9876543210" />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Optional" />
          </div>
        </section>

        {/* Profile details */}
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Profile details</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Home address</label>
              <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls + " resize-none"} placeholder="Permanent home address" />
            </div>
            <div>
              <label className={labelCls}>Workplace / College</label>
              <input value={workplace} onChange={(e) => setWorkplace(e.target.value)} className={inputCls} placeholder="e.g. BITS Pilani" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Emergency contact name</label>
                <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} className={inputCls} placeholder="Parent / guardian" />
              </div>
              <div>
                <label className={labelCls}>Emergency contact phone</label>
                <input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputCls} placeholder="Phone number" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Aadhaar number</label>
              <input value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} maxLength={12} className={inputCls} placeholder="12-digit number" />
            </div>
          </div>
        </section>

        {/* Documents */}
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Photo & documents</h2>
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
        </section>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? "Creating…" : "Create tenant"}
          </button>
          <Link
            href="/tenants"
            className="rounded-lg px-4 py-2.5 text-sm text-gray-500 transition hover:bg-gray-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
