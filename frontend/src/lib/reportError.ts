import * as Sentry from "@sentry/browser";
import { scrubDeep } from "@/lib/scrubPII";

/**
 * The single place a client-side error is reported from.
 *
 * Mirrors `serverError` on the backend, and exists for the same reason: error
 * tracking is wired in here once rather than scattered across every error
 * boundary and catch block. The SDK is configured in instrumentation-client.ts;
 * when NEXT_PUBLIC_SENTRY_DSN is unset, Sentry is never initialised and
 * captureException is an inert no-op — so local development behaves exactly as
 * it did before.
 *
 * The console.error stays regardless. A developer with devtools open should not
 * have to open a dashboard to see what just happened.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  const safeContext = context ? scrubDeep(context) : {};
  console.error("[hostel]", error, safeContext);

  Sentry.captureException(error, {
    // Grouping is left to the SDK here, unlike the backend. A frontend crash's
    // stack trace really is its identity — reportError is called from two
    // boundaries, not fifty handlers, so there is no shared-helper collapse to
    // work around.
    extra: safeContext,
  });
}
