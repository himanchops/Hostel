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
  AlertIcon,
  Badge,
  BedIcon,
  Card,
  CountBadge,
  EmptyState,
  PageHeader,
  RupeeIcon,
  Skeleton,
  SkeletonCard,
  UsersIcon,
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
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={`Welcome back, ${owner?.name?.split(" ")[0] ?? ""}`}
        subtitle="Here's an overview of your properties"
      />

      {/* One place for everything waiting on the owner, rather than a stack of
          competing banners. */}
      {!loading && alerts && (alerts.pending_tenants > 0 || alerts.pending_payments > 0) && (
        <Card title="Needs attention" className="mb-6">
          <div className="divide-y divide-stone-100">
            {alerts.pending_tenants > 0 && (
              <AttentionRow
                href="/pending"
                count={alerts.pending_tenants}
                tone="warning"
                label={`pending registration${alerts.pending_tenants !== 1 ? "s" : ""} awaiting approval`}
              />
            )}
            {alerts.pending_payments > 0 && (
              <AttentionRow
                href="/pending"
                count={alerts.pending_payments}
                tone="info"
                label={`payment proof${alerts.pending_payments !== 1 ? "s" : ""} awaiting approval`}
              />
            )}
          </div>
        </Card>
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
          <StatCard
            label="Total Beds"
            value={(occ?.total_beds ?? 0).toString()}
            icon={<BedIcon className="h-4 w-4" />}
            tone="neutral"
          />
          <StatCard
            label="Occupied"
            value={(occ?.occupied_beds ?? 0).toString()}
            icon={<UsersIcon className="h-4 w-4" />}
            tone="indigo"
            note={occ && occ.total_beds > 0 ? `${occ.percentage.toFixed(0)}% occupancy` : undefined}
          />
          <StatCard
            label="Collected This Month"
            value={formatCurrency(rev?.collected_this_month ?? 0)}
            icon={<RupeeIcon className="h-4 w-4" />}
            tone="emerald"
            note={
              rev && rev.expected_this_month > 0
                ? `of ${formatCurrency(rev.expected_this_month)} expected`
                : undefined
            }
            progress={
              rev && rev.expected_this_month > 0
                ? Math.min(100, (rev.collected_this_month / rev.expected_this_month) * 100)
                : undefined
            }
          />
          <StatCard
            label="Overdue"
            value={formatCurrency(rev?.overdue_amount ?? 0)}
            icon={<AlertIcon className="h-4 w-4" />}
            tone={(rev?.overdue_amount ?? 0) > 0 ? "red" : "neutral"}
            valueClassName={(rev?.overdue_amount ?? 0) > 0 ? "text-overdue-700" : undefined}
            stripe={(rev?.overdue_amount ?? 0) > 0}
            note={
              (rev?.overdue_amount ?? 0) > 0 ? "chase it from Collections →" : undefined
            }
            href={(rev?.overdue_amount ?? 0) > 0 ? "/collections" : undefined}
          />
        </div>
      )}

      {/* No setup yet */}
      {!loading && occ && occ.total_beds === 0 && (
        <EmptyState
          icon={<BedIcon className="h-8 w-8" />}
          title="No beds set up yet"
          message="Add a site with rooms and beds, and the grid and money figures fill in from there."
          action={
            <Link href="/sites" className={buttonClasses({ size: "sm" })}>
              Set up your first site
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
                  {/* Utilisation, not bed status: a nearly-full site goes
                      emerald. This is the one deliberate exception to "green
                      means paid" — noted in DESIGN_PLAN Phase D2. */}
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full ${site.percentage >= 90 ? "bg-emerald-500" : "bg-indigo-500"}`}
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

const STAT_TONES = {
  neutral: "bg-stone-100 text-stone-500",
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
  red: "bg-overdue-100 text-overdue-700",
};

/**
 * One number, with an icon to find it by and an optional note underneath.
 *
 * The overdue card gets a left stripe when it is non-zero — the one figure on
 * this page that should be able to catch the owner's eye from across the room,
 * and the only one that becomes a link, because seeing it always leads to the
 * same next step.
 */
function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  note,
  valueClassName,
  progress,
  stripe = false,
  href,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: keyof typeof STAT_TONES;
  note?: string;
  valueClassName?: string;
  /** 0–100; renders a thin bar under the value. */
  progress?: number;
  stripe?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-stone-500">{label}</p>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${STAT_TONES[tone]}`}>
          {icon}
        </span>
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums text-stone-900 ${valueClassName ?? ""}`}>
        {value}
      </p>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-150 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {note && <p className="mt-1 text-xs tabular-nums text-stone-400">{note}</p>}
    </>
  );

  const className = stripe ? "border-l-[3px] border-l-overdue-500" : "";

  if (href) {
    return (
      <Link href={href} className="block transition duration-150 ease-out hover:opacity-80">
        <Card className={className}>{body}</Card>
      </Link>
    );
  }
  return <Card className={className}>{body}</Card>;
}

/** A row in "Needs attention": count, what it is, and where to deal with it. */
function AttentionRow({
  href,
  count,
  tone,
  label,
}: {
  href: string;
  count: number;
  tone: "warning" | "info";
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 py-3 text-sm transition duration-150 ease-out first:pt-0 last:pb-0 hover:opacity-75"
    >
      <CountBadge tone={tone}>{count}</CountBadge>
      <span className="text-stone-700">{label}</span>
      <span className="ml-auto text-stone-400">→</span>
    </Link>
  );
}
