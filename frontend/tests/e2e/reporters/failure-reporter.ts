import type {
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

export interface FailureEntry {
  title: string;
  file: string;
  error: string;
  location: string;
  screenshotPath?: string;
}

class FailureReporter implements Reporter {
  private outputFile: string = "";
  private failures: FailureEntry[] = [];

  onBegin() {
    // process.cwd() = frontend/ when running `cd frontend && npx playwright test`
    const dir = path.resolve(process.cwd(), "../test-results");
    fs.mkdirSync(dir, { recursive: true });
    this.outputFile = path.join(dir, "failures.json");
    // Reset on each run
    this.failures = [];
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "failed" && result.status !== "timedOut") return;

    const error = result.errors[0];
    const screenshotAttachment = result.attachments.find(
      (a) => a.name === "screenshot"
    );

    this.failures.push({
      title: test.titlePath().join(" > "),
      file: test.location.file,
      error: error?.message ?? "Unknown error",
      location: `${test.location.file}:${test.location.line}`,
      screenshotPath: screenshotAttachment?.path,
    });
  }

  onEnd() {
    fs.writeFileSync(this.outputFile, JSON.stringify(this.failures, null, 2));
    if (this.failures.length > 0) {
      console.log(
        `\n  ${this.failures.length} failure(s) written to test-results/failures.json`
      );
      console.log("  Run 'make fix-tests' to generate a fix report.\n");
    }
  }
}

export default FailureReporter;
