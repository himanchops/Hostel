"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportError } from "@/lib/reportError";
import { Button, Card } from "@/components/ui";

/**
 * Route-level boundary. Unlike `global-error.tsx` this renders inside the root
 * layout, so it keeps global styles and can use the component kit.
 *
 * The recovery prop is `retry` in this version of Next, not `reset`.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "route-error", digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <Card padding="none" className="w-full max-w-md p-8 text-center">
        <h1 className="font-display text-xl font-bold text-stone-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          This page hit an error. Your data is unaffected — nothing was saved by
          the action that failed.
        </p>

        {error.digest && (
          <p className="mt-4 text-xs tabular-nums text-stone-400">
            Reference: {error.digest}
          </p>
        )}

        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/dashboard">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
