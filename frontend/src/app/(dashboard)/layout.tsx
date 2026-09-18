"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { ApiError, collectionsApi, tenantsApi } from "@/lib/api";
import {
  BuildingIcon,
  Button,
  buttonClasses,
  Card,
  ChartIcon,
  ClockIcon,
  ConfirmProvider,
  CountBadge,
  GridIcon,
  RupeeIcon,
  ToastProvider,
  UsersIcon,
  Modal,
  Field,
  Input,
  FormError,
  useToast,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

/**
 * The shell is two layouts sharing one nav definition: a sidebar from 1024px
 * up, a bottom tab bar below it. Tabs rather than a hamburger drawer because
 * the owner uses this one-handed in a corridor — what they do all day should be
 * one thumb-reach away, not behind a menu.
 *
 * Six tabs, not the original five: Insights earned a slot because it is the
 * only answer to "how are we doing", and burying it behind a menu is how a
 * feature goes unused. Six is the ceiling — the labels still fit untruncated at
 * 375px, and a seventh would start eliding them.
 */
type NavItem = {
  label: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactElement;
  count?: number;
  tone?: BadgeTone;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, owner, logout, token, signedOutByChoice } = useAuth();
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
      // Say where they were going, so signing in takes them back there — a
      // bookmarked tenant, or a tab left open overnight, should not land on
      // the dashboard (UX audit M10). Not after choosing to sign out.
      const here = window.location.pathname + window.location.search;
      // The dashboard is where signing in lands anyway, so it needs no `next`.
      const plain = signedOutByChoice || here === "/" || here === "/dashboard";
      router.replace(plain ? "/login" : `/login?next=${encodeURIComponent(here)}`);
    }
  }, [isAuthenticated, isLoading, router, signedOutByChoice]);

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
    { label: "Insights", href: "/insights", icon: ChartIcon },
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
          <span className="font-display text-xl font-semibold text-indigo-600">Hostel Manager</span>
        </div>

        <nav aria-label="Primary" className="flex-1 space-y-0.5 px-3 py-3">
          {navItems.map(({ label, href, icon: Icon, count, tone }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 pointer-coarse:min-h-11 text-sm font-medium transition duration-150 ease-out ${
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
          {/* The name is the way in to the account screen — it is where
              people look for "my account", and it keeps the six-tab nav at
              six. */}
          <Link
            href="/account"
            aria-current={isActive("/account") ? "page" : undefined}
            className={`-m-2 block rounded-lg p-2 transition duration-150 ease-out ${
              isActive("/account") ? "bg-indigo-50" : "hover:bg-stone-100"
            }`}
          >
            <p className="truncate text-sm font-medium text-stone-800">{owner?.name}</p>
            <p className="truncate text-xs text-stone-500">{owner?.email}</p>
            <p className="mt-1 text-xs font-medium text-indigo-600">Account &amp; password</p>
          </Link>
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
          <span className="truncate font-display text-lg font-semibold text-indigo-600">
            Hostel Manager
          </span>

          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className="flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 transition duration-150 ease-out hover:bg-indigo-200"
            >
              {owner?.name?.[0]?.toUpperCase() ?? "?"}
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenOn(null)} />
                <Card className="absolute right-0 z-20 mt-2 w-56 shadow-xl">
                  <p className="truncate text-sm font-medium text-stone-800">{owner?.name}</p>
                  <p className="truncate text-xs text-stone-500">{owner?.email}</p>
                  <Link
                    href="/account"
                    className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-3 w-full" })}
                  >
                    Account &amp; password
                  </Link>
                  <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={signOut}>
                    Sign out
                  </Button>
                </Card>
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
      <SessionEndedDialog />
    </div>
    </ToastProvider>
    </ConfirmProvider>
  );
}

/**
 * Sign in again without leaving the page. The page underneath stays mounted,
 * so a half-typed form survives — which is the point: the only way out of an
 * expired session used to be a reload that threw the form away (UX audit M10).
 */
function SessionEndedDialog() {
  const { sessionEnded, owner, reauthenticate, logoutTo } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await reauthenticate(password);
      setPassword("");
      toast.success("Signed in again — carry on where you were");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setSaving(false);
    }
  }

  function elsewhere() {
    const here = window.location.pathname + window.location.search;
    logoutTo(`/login?next=${encodeURIComponent(here)}`);
  }

  return (
    <Modal
      open={sessionEnded}
      onClose={elsewhere}
      title="You were signed out"
      footer={
        <>
          <Button variant="ghost" onClick={elsewhere}>Use another account</Button>
          <Button type="submit" form="session-ended" loading={saving}>Sign in</Button>
        </>
      }
    >
      <form id="session-ended" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-stone-600">
          Your session ended — it timed out, or someone signed this account out
          everywhere. Sign in again and nothing on this page is lost.
        </p>
        <Field label="Email">
          <Input value={owner?.email ?? ""} readOnly disabled autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input
            required
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
      </form>
    </Modal>
  );
}
