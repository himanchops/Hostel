/**
 * Room for a finger — only where there is a finger.
 *
 * 44px is the smallest target a finger hits reliably (Apple's HIG; WCAG 2.5.5).
 * The UX audit measured almost nothing in the app at that size on an iPad: the
 * nudge button 32px, inputs 38px, a room's rename and delete 24px with no gap
 * between them, and the three stay actions 16px text links — one of which
 * settles a deposit.
 *
 * Keyed on `pointer-coarse:`, never on width, for the reason HOVER_REVEAL
 * gives: an iPad is wider than every phone breakpoint and still has no mouse.
 * A desk with a mouse keeps the compact layout it was designed at.
 *
 * `tests/e2e/owner/touch-targets.test.ts` measures every control on every
 * screen on a touch iPad, so a new screen that forgets this fails the build.
 */

/** A control — button, input, chip, icon button: at least 44×44 under touch. */
export const TOUCH_TARGET = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/**
 * A standalone text link ("View profile →", a breadcrumb): 44px tall under
 * touch, with the growth taken back out of the layout by a negative margin, so
 * the hit area grows and the line it sits on does not move.
 */
export const TOUCH_LINK =
  "inline-flex items-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:-my-3";
