/**
 * Value-level redaction for anything on its way to the error tracker.
 *
 * The browser SDK is configured never to attach cookies, headers or request
 * bodies, so the realistic leak is not a structured field — it is a value
 * interpolated into free text: a thrown Error message, a console breadcrumb,
 * or a URL. This is the frontend half of the same rule enforced in
 * backend/internal/observability/sentry.go, and the patterns are deliberately
 * kept identical so the two halves cannot drift into disagreeing about what
 * counts as sensitive.
 */

// 12 digits, optionally grouped 4-4-4 the way the registration form shows them.
const AADHAAR = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
// Indian mobile numbers: 10 digits starting 6-9, with an optional +91.
const PHONE = /(?:\+?91[ -]?)?\b[6-9]\d{9}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const REDACTED = "[redacted]";

/**
 * Blunt on purpose. Losing a large integer from an error message costs less
 * than sending one national identity number to a third party, and Aadhaar is
 * the only 12-digit run this app realistically handles.
 */
export function scrubPII(value: string): string {
  if (!value) return value;
  return value
    .replace(AADHAAR, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(EMAIL, REDACTED);
}

/** Recursively scrubs the strings inside an arbitrary structure. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === "string") return scrubPII(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => scrubDeep(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrubDeep(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}
