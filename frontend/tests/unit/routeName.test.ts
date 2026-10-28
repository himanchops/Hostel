import { test, expect } from "@playwright/test";
import { routeName } from "../../src/lib/routeName";

// What a page or request is called in Sentry (Oct 2026): one name per page,
// whatever the id, and never a query string.
test("ids become :id, so a page's timings land together", () => {
  expect(routeName("/tenants/12")).toBe("/tenants/:id");
  expect(routeName("/sites/3/grid")).toBe("/sites/:id/grid");
  expect(routeName("https://hostel-backend.onrender.com/api/stays/45/payments")).toBe("/api/stays/:id/payments");
  expect(routeName("/register/4")).toBe("/register/:id");
});

test("query strings and fragments are dropped; words are kept", () => {
  expect(routeName("/api/insights?months=6")).toBe("/api/insights");
  expect(routeName("/pending?tab=payments#top")).toBe("/pending");
  expect(routeName("/payments")).toBe("/payments");
  expect(routeName("/")).toBe("/");
  // Only whole numeric segments: "1U" is a bed name, not an id.
  expect(routeName("/beds/1U")).toBe("/beds/1U");
});
