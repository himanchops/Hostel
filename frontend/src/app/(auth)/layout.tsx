"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { safeNext } from "@/lib/session";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // The same destination the login form picks — this effect fires the
    // moment the session exists, and would otherwise win the race and drop
    // `next` on the floor.
    if (!isLoading && isAuthenticated) {
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-stone-900">Hostel Manager</h1>
          <p className="mt-1 text-sm text-stone-500">Occupancy & rent tracking</p>
        </div>
        {children}
      </div>
    </div>
  );
}
