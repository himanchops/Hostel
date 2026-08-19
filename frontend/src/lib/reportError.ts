/**
 * The single place a client-side error is reported from.
 *
 * Mirrors `serverError` on the backend, and exists for the same reason: when
 * error tracking is added (Sentry, or GlitchTip self-hosted — see
 * docs/DEPLOYMENT.md) it should be wired in here once, not scattered across
 * every error boundary and catch block.
 *
 * Today it only reaches the browser console, which means a crash in a tenant's
 * browser is still effectively invisible to us. That is the gap this function
 * marks rather than closes.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  console.error("[hostel]", error, context ?? {});
}
