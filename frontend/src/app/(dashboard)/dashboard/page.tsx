"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  dashboardApi,
  DashboardData,
  formatCurrency,
} from "@/lib/api";
import {
  Badge,
  Banner,
  Card,
  CountBadge,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonCard,
  buttonClasses,
} from "@/components/ui";

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
      <PageHeader
        title={`Welcome back, ${owner?.name?.split(" ")[0] ?? ""}`}
        subtitle="Here's an overview of your properties"
      />

      {/* Alert banners */}
      {!loading && alerts && (alerts.pending_tenants > 0 || alerts.pending_payments > 0) && (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          {alerts.pending_tenants > 0 && (
            <Banner tone="warning" href="/pending">
              <CountBadge tone="warning">{alerts.pending_tenants}</CountBadge>
              pending registration{alerts.pending_tenants !== 1 ? "s" : ""} awaiting approval
              <span className="ml-auto">→</span>
            </Banner>
          )}
          {alerts.pending_payments > 0 && (
            <Banner tone="info" href="/pending">
              <CountBadge tone="info">{alerts.pending_payments}</CountBadge>
              payment proof{alerts.pending_payments !== 1 ? "s" : ""} awaiting approval
              <span className="ml-auto">→</span>
            </Banner>
          )}
        </div>
      )}

      {/* Stat cards */}
      {loading ? (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Beds" value={(occ?.total_beds ?? 0).toString()} />
          <StatCard
            label="Occupied"
            value={(occ?.occupied_beds ?? 0).toString()}
            note={
              occ && occ.total_beds > 0 ? `${occ.percentage.toFixed(0)}% occupancy` : undefined
            }
          />
          <StatCard
            label="Collected This Month"
            value={formatCurrency(rev?.collected_this_month ?? 0)}
            note={
              rev && rev.expected_this_month > 0
                ? `of ${formatCurrency(rev.expected_this_month)} expected`
                : undefined
            }
          />
          <StatCard
            label="Overdue"
            value={formatCurrency(rev?.overdue_amount ?? 0)}
            valueClassName={(rev?.overdue_amount ?? 0) > 0 ? "text-red-600" : undefined}
          />
        </div>
      )}

      {/* No setup yet */}
      {!loading && occ && occ.total_beds === 0 && (
        <EmptyState
          message="No beds set up yet."
          action={
            <Link href="/sites" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Set up your first site →
            </Link>
          }
        />
      )}

      {/* Main two-column section */}
      {(!loading && occ && occ.total_beds > 0) && (
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Vacating Soon">
            {data!.vacating_soon.length === 0 ? (
              <EmptyState compact message="No tenants vacating in the next 30 days." />
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
                        <Badge tone="warning">Notice: {v.notice_date}</Badge>
                      ) : v.end_date ? (
                        <Badge tone="warning">Ends: {v.end_date}</Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent Payments">
            {data!.recent_payments.length === 0 ? (
              <EmptyState compact message="No payments recorded yet." />
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
                    <div className="shrink-0 space-y-1 text-right">
                      <p className="text-sm font-semibold tabular-nums text-stone-900">
                        {formatCurrency(p.amount)}
                      </p>
                      <p className="text-xs tabular-nums text-stone-400">{p.payment_date}</p>
                      <Badge tone={p.payment_type === "cash" ? "neutral" : "success"}>
                        {p.payment_type}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Per-site occupancy */}
      {!loading && occ && occ.sites.length > 0 && (
        <Card
          title="Sites"
          action={
            <Link href="/sites" className={buttonClasses({ size: "sm" })}>
              Manage sites
            </Link>
          }
        >
          <div className="divide-y divide-stone-100">
            {occ.sites.map((site) => (
              <Link
                key={site.site_id}
                href={`/sites/${site.site_id}/grid`}
                className="flex items-center gap-4 py-3 transition duration-150 ease-out first:pt-0 last:pb-0 hover:opacity-75"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-900">{site.site_name}</p>
                  <p className="text-xs tabular-nums text-stone-500">
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
                  <span className="w-10 text-right text-xs font-medium tabular-nums text-stone-600">
                    {site.percentage.toFixed(0)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Panels still loading */}
      {loading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </Card>
          <Card>
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </Card>
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
    <Card>
      <p className="text-[13px] text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums text-stone-900 ${valueClassName ?? ""}`}>
        {value}
      </p>
      {note && <p className="mt-1 text-xs tabular-nums text-stone-400">{note}</p>}
    </Card>
  );
}
