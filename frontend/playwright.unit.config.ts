import { defineConfig } from "@playwright/test";

// Unit tests for pure functions in src/lib — no browser, no dev server, no DB.
// Kept in a separate config from playwright.config.ts precisely so that running
// them never boots Go or Next: `make verify-frontend` has to stay fast enough
// to run on every save.
export default defineConfig({
  testDir: "tests/unit",
  outputDir: "../test-results/playwright-unit",
  reporter: [["line"]],
});
