"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { sitesApi, Site, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  FormError,
  Input,
  PageHeader,
  SkeletonCard,
  useConfirm,
  useToast,
} from "@/components/ui";

export default function SitesPage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    sitesApi.list(token).then(setSites).finally(() => setLoading(false));
  }, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setFormLoading(true);
    try {
      const site = await sitesApi.create(token, { name: formName, address: formAddress || undefined });
      setSites((prev) => [site, ...prev]);
      setFormName("");
      setFormAddress("");
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create site");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!token) return;
    const ok = await confirm({
      title: "Delete this site?",
      message: "All rooms and data will be removed.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await sitesApi.delete(token, id);
      setSites((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error("Failed to delete site");
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Sites"
        subtitle="Manage your hostel properties"
        actions={<Button onClick={() => setShowForm(true)}>+ Add site</Button>}
      />

      {/* Create form */}
      {showForm && (
        <Card title="New site" className="mb-6">
          <form onSubmit={handleCreate} className="space-y-3">
            {formError && <FormError>{formError}</FormError>}
            <Input
              required
              type="text"
              placeholder="Site name (e.g. Sunrise PG)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <Input
              type="text"
              placeholder="Address (optional)"
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" loading={formLoading}>
                {formLoading ? "Creating…" : "Create"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowForm(false); setFormError(""); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Sites list */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : sites.length === 0 ? (
        <EmptyState message="No sites yet. Add your first one above." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <Card
              key={site.id}
              className="group relative transition duration-150 ease-out hover:ring-indigo-300"
            >
              <Link href={`/sites/${site.id}`} className="block">
                <p className="font-semibold text-stone-900">{site.name}</p>
                {site.address && (
                  <p className="mt-1 text-[13px] text-stone-500">{site.address}</p>
                )}
                <p className="mt-3 text-xs text-indigo-600">View rooms →</p>
              </Link>
              <button
                onClick={() => handleDelete(site.id)}
                className="absolute right-3 top-3 hidden rounded-lg p-1 text-stone-400 transition duration-150 ease-out hover:bg-red-50 hover:text-red-500 group-hover:block"
                title="Delete site"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
