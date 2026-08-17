"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, uploadApi, TenantUpdateData, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  Field,
  FileInput,
  FormError,
  Input,
  PageHeader,
  Textarea,
} from "@/components/ui";

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
      <PageHeader
        title="Add new tenant"
        breadcrumb={[{ label: "Tenants", href: "/tenants" }, { label: "New tenant" }]}
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card title="Basic information">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full name" required>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" />
            </Field>
            <Field label="Phone" required>
              <Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 9876543210" />
            </Field>
          </div>
          <Field label="Email" className="mt-4">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </Field>
        </Card>

        <Card title="Profile details">
          <div className="space-y-4">
            <Field label="Home address">
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="resize-none" placeholder="Permanent home address" />
            </Field>
            <Field label="Workplace / College">
              <Input value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="e.g. BITS Pilani" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Emergency contact name">
                <Input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="Parent / guardian" />
              </Field>
              <Field label="Emergency contact phone">
                <Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="Phone number" />
              </Field>
            </div>
            <Field label="Aadhaar number">
              <Input value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} maxLength={12} placeholder="12-digit number" />
            </Field>
          </div>
        </Card>

        <Card title="Photo & documents">
          <div className="grid grid-cols-3 gap-4">
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

        {error && <FormError>{error}</FormError>}

        <div className="flex gap-3">
          <Button type="submit" loading={loading}>
            {loading ? "Creating…" : "Create tenant"}
          </Button>
          <Link href="/tenants" className="inline-flex items-center rounded-lg px-4 py-2 text-sm text-stone-500 transition duration-150 ease-out hover:bg-stone-100">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
