"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { sitesApi, Site } from "@/lib/api";

export default function DashboardPage() {
  const { owner, token } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    sitesApi.list(token)
      .then(setSites)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {owner?.name?.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Here's an overview of your properties
        </p>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Sites" value={loading ? "—" : sites.length.toString()} />
        <StatCard label="Total Rooms" value="—" note="coming in Phase 2" />
        <StatCard label="Occupancy" value="—" note="coming in Phase 2" />
      </div>

      {/* Sites preview */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Your Sites</h2>
          <Link
            href="/sites"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Manage sites
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            Loading…
          </div>
        ) : sites.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
            <p className="text-sm text-gray-500">No sites yet.</p>
            <Link
              href="/sites"
              className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Add your first site →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200 transition hover:ring-indigo-300"
              >
                <p className="font-semibold text-gray-900">{site.name}</p>
                {site.address && (
                  <p className="mt-1 truncate text-sm text-gray-500">{site.address}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
      {note && <p className="mt-1 text-xs text-gray-400">{note}</p>}
    </div>
  );
}
