import { test, expect } from "@playwright/test";
import { BED_LIFE, STATUS_STYLES } from "../../src/components/ui/StatusPill";

// The legend draws BED_LIFE, not STATUS_STYLES, so a status missing from it
// would have no chip and could never be filtered to.
test("every bed status has a place in the legend, once", () => {
  const legend = BED_LIFE.flat();
  expect(new Set(legend).size).toBe(legend.length);
  expect([...legend].sort()).toEqual(Object.keys(STATUS_STYLES).sort());
});
