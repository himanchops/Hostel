import { test, expect } from "@playwright/test";
import { fitWithin, MAX_EDGE } from "../../src/lib/imageSize";

// The photo that prompted this: a 3024×4032 iPhone portrait uploaded as-is.
test("a phone portrait is capped on its long edge, keeping its shape", () => {
  expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
});

test("landscape is capped on width", () => {
  expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
});

test("an image already within the limit is left alone", () => {
  expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
  expect(fitWithin(MAX_EDGE, MAX_EDGE)).toEqual({ width: MAX_EDGE, height: MAX_EDGE });
});

test("odd sizes round to whole pixels", () => {
  // 1600 / 4000 = 0.4 → 2999 × 0.4 = 1199.6
  expect(fitWithin(2999, 4000)).toEqual({ width: 1200, height: 1600 });
});
