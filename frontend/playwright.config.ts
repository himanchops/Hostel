import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "../test-results/playwright",
  workers: 1, // sequential — tests share dev DB
  reporter: [
    ["html", { outputFolder: "../test-results/playwright-report", open: "never" }],
    ["json", { outputFile: "../test-results/results.json" }],
    ["./tests/e2e/reporters/failure-reporter.ts"],
    ["line"],
  ],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "cd ../backend && go run cmd/server/main.go",
      url: "http://localhost:8080/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
