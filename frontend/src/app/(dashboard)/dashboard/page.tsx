"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  dashboardApi,
  DashboardData,
  formatCurrency,
} from "@/lib/api";

export default function DashboardPage() {
  const { owner, token } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    dashboardApi
      .get(token)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const occ = data?.occupancy;
  const rev = data?.revenue;
  const alerts = data?.alerts;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900">
          Welcome back, {owner?.name?.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Here&apos;s an overview of your properties
        </p>
      </div>

      {/* Alert banners */}
      {!loading && alerts && (alerts.pending_tenants > 0 || alerts.pending_payments > 0) && (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          {alerts.pending_tenants > 0 && (
            <Link
              href="/pending"
              className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                {alerts.pending_tenants}
              </span>
              pending registration{alerts.pending_tenants !== 1 ? "s" : ""} awaiting approval
              <span className="ml-auto">→</span>
            </Link>
          )}
          {alerts.pending_payments > 0 && (
            <Link
              href="/pending"
              className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-800 ring-1 ring-blue-200 transition hover:bg-blue-100"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                {alerts.pending_payments}
              </span>
              payment proof{alerts.pending_payments !== 1 ? "s" : ""} awaiting approval
              <span className="ml-auto">→</span>
            </Link>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Beds"
          value={loading ? "—" : (occ?.total_beds ?? 0).toString()}
        />
        <StatCard
          label="Occupied"
          value={loading ? "—" : (occ?.occupied_beds ?? 0).toString()}
          note={
            !loading && occ && occ.total_beds > 0
              ? `${occ.percentage.toFixed(0)}% occupancy`
              : undefined
          }
        />
        <StatCard
          label="Collected This Month"
          value={loading ? "—" : formatCurrency(rev?.collected_this_month ?? 0)}
          note={
            !loading && rev && rev.expected_this_month > 0
              ? `of ${formatCurrency(rev.expected_this_month)} expected`
              : undefined
          }
        />
        <StatCard
          label="Overdue"
          value={loading ? "—" : formatCurrency(rev?.overdue_amount ?? 0)}
          valueClassName={
            !loading && (rev?.overdue_amount ?? 0) > 0 ? "text-red-600" : undefined
          }
        />
      </div>

      {/* No setup yet */}
      {!loading && occ && occ.total_beds === 0 && (
        <div className="mb-8 rounded-xl border-2 border-dashed border-stone-200 py-12 text-center">
          <p className="text-sm text-stone-500">No beds set up yet.</p>
          <Link
            href="/sites"
            className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Set up your first site →
          </Link>
        </div>
      )}

      {/* Main two-column section */}
      {(!loading && occ && occ.total_beds > 0) && (
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Vacating soon */}
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <h2 className="mb-4 text-sm font-semibold text-stone-900">Vacating Soon</h2>
            {data!.vacating_soon.length === 0 ? (
              <p className="text-sm text-stone-400">No tenants vacating in the next 30 days.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data!.vacating_soon.map((v, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-stone-900">{v.tenant_name}</p>
                      <p className="text-xs text-stone-500">
                        {v.site_name} · {v.room_name} · {v.bed_name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {v.notice_date ? (
                        <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Notice: {v.notice_date}
                        </span>
                      ) : v.end_date ? (
                        <span className="inline-block rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          Ends: {v.end_date}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent payments */}
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <h2 className="mb-4 text-sm font-semibold text-stone-900">Recent Payments</h2>
            {data!.recent_payments.length === 0 ? (
              <p className="text-sm text-stone-400">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data!.recent_payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-stone-900">{p.tenant_name}</p>
                      <p className="text-xs text-stone-500">
                        {p.site_name} · {p.room_name} · {p.bed_name}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-stone-900">
                        {formatCurrency(p.amount)}
                      </p>
                      <p className="text-xs text-stone-400">{p.payment_date}</p>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.payment_type === "cash"
                          ? "bg-stone-100 text-stone-600"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {p.payment_type}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Per-site occupancy */}
      {!loading && occ && occ.sites.length > 0 && (
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900">Sites</h2>
            <Link
              href="/sites"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Manage sites
            </Link>
          </div>
          <div className="divide-y divide-stone-100">
            {occ.sites.map((site) => (
              <Link
                key={site.site_id}
                href={`/sites/${site.site_id}/grid`}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0 hover:opacity-75"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-900">{site.site_name}</p>
                  <p className="text-xs text-stone-500">
                    {site.occupied_beds} / {site.total_beds} beds occupied
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${site.percentage}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs font-medium text-stone-600">
                    {site.percentage.toFixed(0)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-stone-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          Loading…
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  valueClassName,
}: {
  label: string;
  value: string;
  note?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
      <p className="text-sm text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold text-stone-900 ${valueClassName ?? ""}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-stone-400">{note}</p>}
    </div>
  );
}
