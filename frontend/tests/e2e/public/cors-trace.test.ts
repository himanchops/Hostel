import { test, expect } from "@playwright/test";

const BASE = "http://localhost:8080";

/**
 * With tracing on (Oct 2026), the browser adds `sentry-trace` and `baggage`
 * to every request it sends the backend. Local development has no Sentry DSN,
 * so the app never sends them here and a CORS rule that refused them would
 * pass every other test and break every request in production. This sends
 * the preflight a traced request makes and checks the server allows it.
 */
test("the backend's CORS rule allows the trace headers", async ({ request }) => {
  const res = await request.fetch(`${BASE}/api/me`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,sentry-trace,baggage",
    },
  });
  expect(res.status()).toBe(204);
  const allowed = (res.headers()["access-control-allow-headers"] ?? "").toLowerCase();
  for (const h of ["authorization", "sentry-trace", "baggage"]) expect(allowed).toContain(h);
});
