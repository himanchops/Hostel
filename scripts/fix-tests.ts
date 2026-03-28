/**
 * fix-tests.ts
 *
 * Reads test-results/failures.json produced by the Playwright failure reporter.
 * Categorizes each failure and writes a targeted fix report to
 * test-results/fix-report.md.
 *
 * The report is designed to be actionable: paste it back to Claude Code and
 * say "fix these" to apply changes.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FAILURES_FILE = path.join(ROOT, "test-results", "failures.json");
const REPORT_FILE = path.join(ROOT, "test-results", "fix-report.md");

interface FailureEntry {
  title: string;
  file: string;
  error: string;
  location: string;
  screenshotPath?: string;
}

type FailureCategory =
  | "api-error"
  | "navigation"
  | "missing-element"
  | "text-assertion"
  | "timeout"
  | "unknown";

function categorize(failure: FailureEntry): {
  category: FailureCategory;
  likelyCause: string;
  suggestion: string;
} {
  const err = failure.error.toLowerCase();

  // API / network errors
  if (
    err.includes("failed (") ||
    err.includes("status()") ||
    err.includes("api") ||
    err.includes("fetch") ||
    err.includes("500") ||
    err.includes("400") ||
    err.includes("404")
  ) {
    const statusMatch = failure.error.match(/\((\d{3})\)/);
    const status = statusMatch?.[1] ?? "5xx";
    return {
      category: "api-error",
      likelyCause: `Backend API returned HTTP ${status}. The handler may be throwing an unhandled error, or the request shape is wrong.`,
      suggestion: [
        "1. Run `make backend` and reproduce the request manually with curl or the browser DevTools Network tab.",
        "2. Check the Go handler for the relevant endpoint — look for error conditions that return 500.",
        "3. Check that all required fields are being sent in the request body.",
        "4. If the error is 'failed to scan' or similar, check that nullable DB columns use `*string` / `sql.NullString` in the model struct.",
      ].join("\n"),
    };
  }

  // Navigation / redirect failures
  if (
    err.includes("tohaveurl") ||
    err.includes("url") ||
    err.includes("redirect")
  ) {
    return {
      category: "navigation",
      likelyCause: "Page did not navigate to the expected URL after an action.",
      suggestion: [
        "1. Check that the action (button click, form submit) is completing successfully.",
        "2. Check Next.js route definitions and middleware for unexpected redirects.",
        "3. Check that the auth guard isn't redirecting to /login unexpectedly.",
      ].join("\n"),
    };
  }

  // Missing element (locator not found)
  if (
    err.includes("locator") ||
    err.includes("getbyrole") ||
    err.includes("getbytext") ||
    err.includes("visible") ||
    err.includes("waiting for")
  ) {
    return {
      category: "missing-element",
      likelyCause: "An expected element was not found in the page. The selector may be stale, or the component may not be rendering.",
      suggestion: [
        "1. Check whether the element text/role has changed in the frontend component.",
        "2. Check whether the component is conditionally rendered and what condition is blocking it.",
        "3. Run the test in headed mode (`make test-e2e-ui`) to see what the page looks like at failure.",
      ].join("\n"),
    };
  }

  // Text content assertion failures
  if (err.includes("tocontaintext") || err.includes("tohavetext") || err.includes("expect(")) {
    return {
      category: "text-assertion",
      likelyCause: "Page text did not match the expected value. The UI content may have changed, or the data is not loading correctly.",
      suggestion: [
        "1. Check the component rendering logic for the expected text.",
        "2. Check whether the API response shape matches what the frontend expects.",
        "3. Compare the actual vs expected values in the error message above.",
      ].join("\n"),
    };
  }

  // Timeout
  if (err.includes("timeout") || err.includes("exceeded")) {
    return {
      category: "timeout",
      likelyCause: "Test timed out waiting for an element or network request to complete.",
      suggestion: [
        "1. Check whether the backend is running and responding in time.",
        "2. Check for infinite loading states in the frontend (API error not handled, spinner never stops).",
        "3. Run `make dev` first and verify the page loads manually before running tests.",
      ].join("\n"),
    };
  }

  return {
    category: "unknown",
    likelyCause: "Could not automatically categorize this failure.",
    suggestion:
      "1. Read the full error message above.\n2. Run the test in debug mode: `make test-e2e-debug`",
  };
}

function main() {
  if (!fs.existsSync(FAILURES_FILE)) {
    console.error("No failures.json found. Run `make test-e2e` first.");
    process.exit(1);
  }

  const failures: FailureEntry[] = JSON.parse(
    fs.readFileSync(FAILURES_FILE, "utf-8")
  );

  if (failures.length === 0) {
    console.log("No failures found in failures.json — all tests passed!");
    process.exit(0);
  }

  const lines: string[] = [
    "# Fix Report",
    "",
    `Generated from \`test-results/failures.json\` — ${failures.length} failure(s)`,
    "",
    "---",
    "",
  ];

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i];
    const { category, likelyCause, suggestion } = categorize(f);

    lines.push(`## ${i + 1}. ${f.title}`);
    lines.push("");
    lines.push(`**Category**: \`${category}\``);
    lines.push(`**Test file**: \`${f.file}\``);
    lines.push(`**Location**: \`${f.location}\``);
    lines.push("");
    lines.push("**Error:**");
    lines.push("```");
    lines.push(f.error.trim().slice(0, 800)); // cap length
    lines.push("```");
    lines.push("");
    lines.push(`**Likely cause**: ${likelyCause}`);
    lines.push("");
    lines.push("**Suggested fix steps:**");
    lines.push(suggestion);

    if (f.screenshotPath) {
      const rel = path.relative(ROOT, f.screenshotPath);
      lines.push("");
      lines.push(`**Screenshot**: \`${rel}\``);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push(
    "> Paste this report to Claude Code and say **\"fix these\"** to apply changes."
  );

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, lines.join("\n"));
  console.log(`Fix report written to test-results/fix-report.md`);
  console.log(`${failures.length} failure(s) categorized.`);
}

main();
