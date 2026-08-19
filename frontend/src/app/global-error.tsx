"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/reportError";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, where
 * `error.tsx` cannot reach.
 *
 * Two constraints from Next's docs (node_modules/next/dist/docs — this version
 * differs from what you may remember):
 *   1. it must render its own <html> and <body>, because it replaces the root
 *      layout rather than nesting inside it;
 *   2. it does NOT receive global styles, so Tailwind classes would silently do
 *      nothing here. Everything below is inline on purpose.
 *
 * The recovery prop is `retry` in this version, not `reset`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "global-error", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "#fafaf9",
          color: "#1c1917",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        <title>Something went wrong — Hostel Manager</title>
        <main
          style={{
            width: "100%",
            maxWidth: "26rem",
            background: "#fff",
            border: "1px solid #e7e5e4",
            borderRadius: "0.75rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#78716c" }}>
            The app hit an error it could not recover from on its own. Your data
            is unaffected — nothing was saved by the action that failed.
          </p>

          {/* The digest is the only handle on this crash in a server log, so it
              goes on screen where someone can quote it back to us. */}
          {error.digest && (
            <p
              style={{
                margin: "1rem 0 0",
                fontSize: "0.75rem",
                color: "#a8a29e",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          <button
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              width: "100%",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#fff",
              background: "#4f46e5",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
