/**
 * Client-side error tracking init.
 *
 * Next loads this file itself on the client (it is a Next convention, not a
 * Sentry one), which is why this needs no build plugin and no wrapping of
 * next.config.ts. `@sentry/browser` is used rather than `@sentry/nextjs`
 * deliberately — see docs/DEPLOYMENT.md → "Where the logs go" for the reasoning
 * and for what that costs.
 *
 * Reporting itself goes through lib/reportError.ts. This file only decides what
 * the SDK is allowed to collect.
 */
import * as Sentry from "@sentry/browser";
import { scrubPII, scrubDeep } from "@/lib/scrubPII";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  // Next's own guidance for this file: wrap instrumentation in try/catch so a
  // failure here cannot take the app down with it. An error tracker that
  // breaks the page it is watching is worse than no error tracker.
  try {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
      // Vercel exposes the deployed commit; without a release, "did this start
      // after Tuesday's deploy?" is unanswerable.
      release: process.env.NEXT_PUBLIC_COMMIT_SHA || undefined,

      // Errors only. Tracing samples every navigation and is a much larger quota
      // conversation than this change is making.
      tracesSampleRate: 0,

      // No IP address, no cookies, no user identity. The owner id the backend
      // attaches to its own events is enough to correlate.
      sendDefaultPii: false,

      // The default integration set includes breadcrumbs for fetch and XHR. Those
      // record method, URL and status — not bodies — which is exactly the useful
      // half. They are kept, and their text is scrubbed in beforeBreadcrumb below.
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.message) breadcrumb.message = scrubPII(breadcrumb.message);
        if (breadcrumb.data) breadcrumb.data = scrubDeep(breadcrumb.data);
        return breadcrumb;
      },

      beforeSend(event) {
        // Free text is the only place PII realistically reaches this SDK, since
        // no request body or header is ever attached.
        if (event.message) event.message = scrubPII(event.message);
        for (const ex of event.exception?.values ?? []) {
          if (ex.value) ex.value = scrubPII(ex.value);
        }
        if (event.request?.url) event.request.url = scrubPII(event.request.url);
        // Our own context objects, which callers control and could widen later.
        if (event.extra) event.extra = scrubDeep(event.extra);
        // Never send cookies or headers even if a future SDK default adds them.
        delete event.request?.cookies;
        delete event.request?.headers;
        return event;
      },
    });
  } catch (e) {
    console.error("[hostel] error tracking failed to initialise", e);
  }
}

/**
 * Navigation breadcrumbs. "Which page were they on when it broke" is the first
 * question asked of any crash report, and a client-rendered app answers it
 * nowhere else.
 */
export function onRouterTransitionStart(url: string) {
  Sentry.addBreadcrumb({
    category: "navigation",
    message: scrubPII(url),
    level: "info",
  });
}
