"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { collectionsApi, tenantsApi } from "@/lib/api";
import { Button, ConfirmProvider, CountBadge, ToastProvider } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

/**
 * The shell is two layouts sharing one nav definition: a sidebar from 1024px
 * up, a bottom tab bar below it. Tabs rather than a hamburger drawer because
 * the owner uses this one-handed in a corridor — the five things they do all
 * day should be one thumb-reach away, not behind a menu.
 */
type NavItem = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactElement;
  count?: number;
  tone?: BadgeTone;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, owner, logout, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [collectionsCount, setCollectionsCount] = useState(0);
  // Stores the route the menu was opened on rather than a bare boolean, so a
  // navigation closes it for free. Resetting it from an effect instead would
  // mean a setState during render's commit — the thing react-hooks warns about.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;

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

  const navItems: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: GridIcon },
    // Collections sits second: it is the daily loop — rent day, who hasn't
    // paid, chase them.
    { label: "Collections", href: "/collections", icon: RupeeIcon, count: collectionsCount, tone: "danger" },
    { label: "Sites", href: "/sites", icon: BuildingIcon },
    { label: "Tenants", href: "/tenants", icon: UsersIcon },
    { label: "Pending", href: "/pending", icon: ClockIcon, count: pendingCount, tone: "warning" },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  function signOut() {
    logout();
    router.replace("/login");
  }

  return (
    <ConfirmProvider>
    <ToastProvider>
    <div className="flex min-h-screen bg-stone-50">
      {/* Sidebar — 1024px and up */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <span className="text-lg font-bold text-indigo-600">Hostel Manager</span>
        </div>

        <nav aria-label="Primary" className="flex-1 space-y-0.5 px-3 py-3">
          {navItems.map(({ label, href, icon: Icon, count, tone }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ease-out ${
                isActive(href)
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
          ))}
        </nav>

        <div className="border-t border-stone-100 p-4">
          <p className="truncate text-sm font-medium text-stone-800">{owner?.name}</p>
          <p className="truncate text-xs text-stone-500">{owner?.email}</p>
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main column. min-w-0 so wide children (tables, the grid) shrink
          instead of pushing the whole page sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim top bar — below 1024px only */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 lg:hidden">
          {/* The wordmark, not the page title: every page already opens with
              its own <h1>, and the tab bar below shows which section is
              active — a title here would just say the same thing twice. */}
          <span className="truncate text-base font-bold text-indigo-600">
            Hostel Manager
          </span>

          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 transition duration-150 ease-out hover:bg-indigo-200"
            >
              {owner?.name?.[0]?.toUpperCase() ?? "?"}
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenOn(null)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl bg-white p-4 shadow-xl ring-1 ring-stone-200">
                  <p className="truncate text-sm font-medium text-stone-800">{owner?.name}</p>
                  <p className="truncate text-xs text-stone-500">{owner?.email}</p>
                  <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* pb-20 clears the fixed tab bar; the sidebar layout needs no gap. */}
        <main className="min-w-0 flex-1 overflow-x-hidden pb-20 lg:pb-0">
          {children}
        </main>
      </div>

      {/* Bottom tab bar — below 1024px only */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {navItems.map(({ label, href, icon: Icon, count, tone }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition duration-150 ease-out ${
                active ? "text-indigo-700" : "text-stone-500"
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {count !== undefined && count > 0 && (
                  <span className="absolute -right-2.5 -top-1.5">
                    <CountBadge tone={tone} size="sm">{count}</CountBadge>
                  </span>
                )}
              </span>
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
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
