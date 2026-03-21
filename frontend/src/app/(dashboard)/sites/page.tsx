"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { sitesApi, Site, ApiError } from "@/lib/api";

export default function SitesPage() {
  const { token } = useAuth();
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
    if (!token || !confirm("Delete this site? All rooms and data will be removed.")) return;
    try {
      await sitesApi.delete(token, id);
      setSites((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Failed to delete site");
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sites</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your hostel properties</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          + Add site
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <h3 className="mb-4 text-base font-semibold text-gray-900">New site</h3>
          {formError && (
            <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{formError}</div>
          )}
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              required
              type="text"
              placeholder="Site name (e.g. Sunrise PG)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <input
              type="text"
              placeholder="Address (optional)"
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={formLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {formLoading ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(""); }}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sites list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          Loading…
        </div>
      ) : sites.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-500">No sites yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <div
              key={site.id}
              className="group relative rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200 transition hover:ring-indigo-300"
            >
              <Link href={`/sites/${site.id}`} className="block">
                <p className="font-semibold text-gray-900">{site.name}</p>
                {site.address && (
                  <p className="mt-1 text-sm text-gray-500">{site.address}</p>
                )}
                <p className="mt-3 text-xs text-indigo-600">View rooms →</p>
              </Link>
              <button
                onClick={() => handleDelete(site.id)}
                className="absolute right-4 top-4 hidden rounded p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500 group-hover:block"
                title="Delete site"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
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
