import { test, expect } from "@playwright/test";
import { scrubPII, scrubDeep } from "../../src/lib/scrubPII";

// These are the values a real tenant types into the public registration form.
// The frontend SDK never attaches request bodies or headers, so the realistic
// leak is a value interpolated into a *string* — a thrown Error, a console
// breadcrumb, a URL. That is what these cover.
//
// The Go half of this lives in backend/internal/observability/sentry_test.go
// and asserts the same things against the same patterns; the two are meant to
// stay in step.

test("Aadhaar numbers are redacted, grouped or not", () => {
  expect(scrubPII("aadhaar 1234 5678 9012 rejected")).toBe("aadhaar [redacted] rejected");
  expect(scrubPII("aadhaar 123456789012 rejected")).toBe("aadhaar [redacted] rejected");
  expect(scrubPII("aadhaar 1234-5678-9012 rejected")).toBe("aadhaar [redacted] rejected");
});

test("Indian mobile numbers are redacted, with or without country code", () => {
  expect(scrubPII("could not reach 9876543210")).toBe("could not reach [redacted]");
  expect(scrubPII("could not reach +91 9123456780")).toBe("could not reach [redacted]");
});

test("email addresses are redacted", () => {
  expect(scrubPII("no owner for priya.sharma@example.com")).toBe("no owner for [redacted]");
});

// The scrubber has to stay useful, not just safe. An error message stripped of
// every number is an error message nobody can act on.
test("ids and money amounts survive so error text stays readable", () => {
  expect(scrubPII("stay 42 has 3 payments totalling 250000 paise")).toBe(
    "stay 42 has 3 payments totalling 250000 paise",
  );
  expect(scrubPII("failed to load /api/tenants/1729")).toBe("failed to load /api/tenants/1729");
});

// A landline-style or leading-5 number is not an Indian mobile and is left
// alone; the point is to be blunt about the formats this app actually handles,
// not to redact every ten-digit run in existence.
test("numbers that are not Indian mobiles are left alone", () => {
  expect(scrubPII("code 5123456789 returned")).toBe("code 5123456789 returned");
});

test("scrubDeep reaches strings nested in context objects", () => {
  const context = {
    boundary: "route-error",
    tenant: { phone: "9876543210", note: "ok" },
    tags: ["email priya.sharma@example.com", "clean"],
  };
  expect(scrubDeep(context)).toEqual({
    boundary: "route-error",
    tenant: { phone: "[redacted]", note: "ok" },
    tags: ["email [redacted]", "clean"],
  });
});

// Documented limitation, asserted so it cannot change by accident. A name is
// not matchable by pattern — anything that caught "Priya Sharma" would also
// eat "Postgres Error" — so names are kept out of the tracker by the rule that
// handlers do not interpolate tenant fields into error messages, not by this
// function. See docs/DEPLOYMENT.md → "What the scrubber does not cover".
test("names are NOT redacted — this is a convention, not a filter", () => {
  expect(scrubPII("could not render tenant Priya Sharma")).toBe(
    "could not render tenant Priya Sharma",
  );
});
