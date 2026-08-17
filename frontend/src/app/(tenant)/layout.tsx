"use client";

import { useTenantAuth } from "@/contexts/tenantAuth";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, tenant, logout } = useTenantAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white shadow-sm ring-1 ring-stone-200">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/my" className="text-base font-bold text-indigo-600">
            My Portal
          </Link>
          {isAuthenticated && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-stone-600">{tenant?.name}</span>
              <button
                onClick={() => { logout(); router.replace("/my/login"); }}
                className="text-sm text-stone-400 hover:text-stone-600"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
