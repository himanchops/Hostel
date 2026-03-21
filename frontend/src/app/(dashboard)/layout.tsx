"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { tenantsApi } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, owner, logout, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!token) return;
    tenantsApi.list(token, true).then((t) => setPendingCount(t.length)).catch(() => {});
  }, [token, pathname]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-white shadow-sm ring-1 ring-gray-200">
        <div className="flex h-16 items-center px-5">
          <span className="text-lg font-bold text-indigo-600">Hostel Manager</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {[
            { label: "Dashboard", href: "/dashboard", icon: GridIcon },
            { label: "Sites", href: "/sites", icon: BuildingIcon },
            { label: "Tenants", href: "/tenants", icon: UsersIcon },
          ].map(({ label, href, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
          {/* Pending registrations */}
          <Link
            href="/pending"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              pathname === "/pending"
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <ClockIcon className="h-4 w-4 shrink-0" />
            Pending
            {pendingCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700">
                {pendingCount}
              </span>
            )}
          </Link>
        </nav>

        <div className="border-t border-gray-100 p-4">
          <p className="truncate text-sm font-medium text-gray-800">{owner?.name}</p>
          <p className="truncate text-xs text-gray-500">{owner?.email}</p>
          <button
            onClick={() => { logout(); router.replace("/login"); }}
            className="mt-3 w-full rounded-lg px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
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

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
