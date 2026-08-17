"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { collectionsApi, tenantsApi } from "@/lib/api";
import { Button, ConfirmProvider, CountBadge, ToastProvider } from "@/components/ui";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, owner, logout, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [collectionsCount, setCollectionsCount] = useState(0);

  // Refetched on every navigation so the badges settle after a payment is
  // recorded or a registration is approved.
  useEffect(() => {
    if (!token) return;
    tenantsApi.list(token, true).then((t) => setPendingCount(t.length)).catch(() => {});
    collectionsApi.list(token).then((rows) => setCollectionsCount(rows.length)).catch(() => {});
  }, [token, pathname]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <ConfirmProvider>
    <ToastProvider>
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-stone-200 bg-white">
        <div className="flex h-16 items-center px-5">
          <span className="text-lg font-bold text-indigo-600">Hostel Manager</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {[
            { label: "Dashboard", href: "/dashboard", icon: GridIcon },
            // Collections sits second: it is the daily loop — rent day, who
            // hasn't paid, chase them.
            { label: "Collections", href: "/collections", icon: RupeeIcon,
              count: collectionsCount, tone: "danger" as const },
            { label: "Sites", href: "/sites", icon: BuildingIcon },
            { label: "Tenants", href: "/tenants", icon: UsersIcon },
            { label: "Pending", href: "/pending", icon: ClockIcon,
              count: pendingCount, tone: "warning" as const },
          ].map(({ label, href, icon: Icon, count, tone }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className="ml-auto">
                    <CountBadge tone={tone}>{count}</CountBadge>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-stone-100 p-4">
          <p className="truncate text-sm font-medium text-stone-800">{owner?.name}</p>
          <p className="truncate text-xs text-stone-500">{owner?.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => { logout(); router.replace("/login"); }}
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
    </ToastProvider>
    </ConfirmProvider>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M9 21V7l6-4v18M9 11h6M9 15h6" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function RupeeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h12M6 9h12M15.5 4c0 4-2.5 5-5.5 5m0 0c4.5 0 7 2 7 5.5S14 20 10 20l8-8" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
