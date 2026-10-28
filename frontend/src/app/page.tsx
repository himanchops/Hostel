"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { PageLoader } from "@/components/ui";
import { ServerUnreachable } from "@/components/ServerUnreachable";

export default function Home() {
  const { isAuthenticated, isLoading, unreachable, retryRestore } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !unreachable) {
      router.replace(isAuthenticated ? "/dashboard" : "/login");
    }
  }, [isAuthenticated, isLoading, unreachable, router]);

  if (unreachable) return <ServerUnreachable onRetry={retryRestore} />;

  // PageLoader, not a bare spinner: checking the saved sign-in is the first
  // request after a quiet spell, and the loader says the server is waking.
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <PageLoader />
    </div>
  );
}
