/**
 * A secondary control that hides until its row is hovered — only on devices
 * that can hover.
 *
 * Put `group` on the row and this on the control:
 *
 *   <tr className="group"> … <button className={`… ${HOVER_REVEAL}`}>✕</button>
 *
 * Why a shared constant rather than classes written inline: the UX audit found
 * this recipe fixed in one file of four, and the one "correct" copy was wrong
 * for the device this app is mostly used on.
 *
 * - `hidden group-hover:block` (the original) is display:none on any touch
 *   screen and unreachable by keyboard everywhere. It made correcting a
 *   payment impossible on a phone.
 * - `sm:opacity-0 sm:group-hover:opacity-100` (Phase 16's fix) keys off WIDTH.
 *   An iPad is wider than `sm`, and Tailwind v4 wraps every hover variant in
 *   `@media (hover: hover)`, which a touch iPad does not match — so on the
 *   primary device the control was invisible and still tappable by accident.
 *
 * `pointer-fine:` asks the right question: is there a mouse? Only then is the
 * control tucked away. focus-visible brings it back for keyboard users, and
 * both reveal rules out-specify the hiding one, so their order in the
 * generated CSS does not matter.
 */
export const HOVER_REVEAL =
  "pointer-fine:opacity-0 group-hover:opacity-100 focus-visible:opacity-100";
