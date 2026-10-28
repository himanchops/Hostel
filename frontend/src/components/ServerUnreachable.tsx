"use client";

import { Button, EmptyState } from "@/components/ui";

/**
 * What a signed-in screen shows when the saved sign-in could not be checked
 * because the server never answered. It used to sign the owner out instead,
 * so a server still waking from Render's sleep sent them to the login page
 * (Oct 2026). The sign-in is still there; trying again is all it takes.
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <EmptyState
        title="Couldn't reach the server"
        message="You're still signed in. It may be waking up after a quiet spell; try again in a moment."
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    </div>
  );
}
