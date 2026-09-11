import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A source guard, not a behaviour test: no control may be hidden behind hover
 * alone. The behaviour is checked in tests/e2e/owner/hover-reveal.test.ts, but
 * only on the screens that exist today — this catches the next one.
 *
 * The UX audit found the bare `hidden … group-hover:block` pattern on three
 * destructive controls, and Phase 16's replacement (`sm:opacity-0
 * sm:group-hover:opacity-100`) invisible on an iPad. The one right recipe is
 * HOVER_REVEAL in components/ui/reveal.ts — whose own comment quotes both bad
 * patterns, and is therefore the one file skipped.
 */
const BANNED: [RegExp, string][] = [
  [/group-hover:(block|inline|inline-flex|flex|grid|visible)\b/, "display toggled by hover — invisible on touch"],
  [/\bsm:opacity-0\b/, "hidden by width, not by pointer — invisible on an iPad"],
  [/\bsm:group-hover:/, "hover reveal keyed off width — use HOVER_REVEAL"],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

test("no control is hidden behind hover alone", () => {
  const src = join(test.info().project.testDir, "../../src");
  const offenders: string[] = [];

  for (const file of sourceFiles(src)) {
    if (file.endsWith(join("components", "ui", "reveal.ts"))) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const [pattern, why] of BANNED) {
        if (pattern.test(line)) offenders.push(`${relative(src, file)}:${i + 1} — ${why}`);
      }
    });
  }

  expect(offenders).toEqual([]);
});
