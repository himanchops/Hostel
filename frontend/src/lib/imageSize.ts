/**
 * Pure size arithmetic for shrinkImage.ts, kept apart from the canvas code so
 * it can be unit-tested without a browser.
 *
 * 1600px on the long edge: small enough that a phone photo drops from 3–5 MB
 * to a few hundred KB, large enough that an ID card's small print stays
 * readable when the owner zooms in.
 */
export const MAX_EDGE = 1600;

/** The size an image of w×h becomes when its long edge is capped at max. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const scale = max / long;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
