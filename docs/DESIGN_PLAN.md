# UI Modernization Plan

Written after a design review of the frontend (Apr 2026 state: Phases 0–9.1 done).
This doc is the **execution contract**: each phase is independently shippable,
ordered by dependency, and scoped so a smaller model can implement it without
extra design decisions. Do the phases in order. Do not restyle pages before
Phase B is complete.

**Sequencing with feature work:** the overall roadmap (see "Roadmap decision"
in `PROGRESS.md`) interleaves two feature phases: **Phase 10 — Collections &
WhatsApp nudges** lands right after Phase B (build that page WITH the new
component kit — it must not ship with hand-rolled styles), and **Phase 11 —
Settlement calculator** lands after Phase E. When Phases C–E touch "every
page", that includes the Collections page.

## Design direction (decided — don't relitigate per page)

**"Calm ledger."** A hostel owner uses this daily to answer one question: *who
owes me money and where.* The design should feel like a clean physical ledger:
quiet neutral surfaces, one confident accent, and the five bed-status colors as
the loudest thing on any screen. No gradients, no glassmorphism, no dashboard-
template noise.

- **Typography**: Geist Sans everywhere (it's already loaded — see A1). Type
  scale: 13px secondary / 14px body / 16px section titles / 22px page titles.
  Tabular numerals (`tabular-nums`) on ALL money and counts.
- **Color**: neutrals move from `gray` to `stone` (warmer, less clinical).
  Accent stays **indigo** but used sparingly: primary buttons, active nav,
  links. Status colors (green/yellow/red/orange/gray) are reserved for bed
  status ONLY — never reuse them decoratively.
- **Surfaces**: `bg-stone-50` app background, white cards, `rounded-xl`,
  `ring-1 ring-stone-200`, no drop shadows except overlays (drawers/modals get
  `shadow-xl`). One card recipe, used everywhere.
- **Density**: this is a data tool. Prefer 8px gaps and 12–16px card padding
  over airy spacing. Tables/lists: 40px rows.
- **Motion**: 150ms ease-out transitions on hover/press; drawer slide-in;
  nothing else. No scroll animations.

---

## Phase A — Foundations (half a session)

**A1. Fix the font.** `globals.css` body rule says `font-family: Arial`.
Replace with `var(--font-geist-sans)`. Add `font-feature-settings` nothing —
just ensure `tabular-nums` utility is applied to numeric cells (done per-
component in Phase B/D).

**A2. Remove fake dark mode.** Delete the `prefers-color-scheme: dark` block
in `globals.css`. Components hardcode light colors; the half-flip breaks auth
pages on dark-mode devices. (Real dark mode is out of scope.)

**A3. Design tokens.** In `globals.css` under `@theme`, define:

```css
@theme inline {
  --font-sans: var(--font-geist-sans);
  /* status palette — single source of truth */
  --color-status-vacant: theme colors stone-400;
  --color-status-paid: emerald;
  --color-status-partial: amber;
  --color-status-overdue: red;
  --color-status-vacating: orange;
}
```

(Implementer: use Tailwind 4 `@theme` custom properties with actual hex values
from the emerald/amber/red/orange/stone-400 500-weight hues. The point is that
grid, legend, badges, and dashboard all read the SAME tokens.)

**A4. Global neutral swap.** Project-wide find/replace `gray-` → `stone-` in
classNames. Mechanical; do it in one commit so it's reviewable.

**Acceptance:** app renders in Geist; no visual regressions beyond warmer
grays; `make test-e2e` passes.

---

## Phase B — Component kit (1–2 sessions) ⚠️ blocking everything after it

Create `frontend/src/components/ui/`. Extract these, replacing ALL page-local
duplicates as you go (that's the deliverable — the pages must actually use
them, not just the files existing):

| Component | API sketch | Replaces |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size: sm\|md`, `loading` | every `<button>`/link-button |
| `Card` | `title?`, `action?` (right-side slot), children | every `rounded-xl bg-white ring-1` div |
| `Input`, `Select`, `Field` | `Field` wraps label+input+error | all form fields (there are ~40) |
| `StatusPill` | `status: BedStatus`, reads Phase A tokens | grid legend, bed cards, dashboard badges |
| `Badge` | `tone: neutral\|success\|warning\|danger\|info` | payment type, notice chips, counts |
| `Drawer` | right-side overlay, ESC/backdrop close, slide-in | grid side panel, pending ReviewDrawer |
| `Modal` | centered, small | assign-bed modal, any confirm |
| `ConfirmDialog` | promise-based `confirm(opts)` helper on Modal | ALL browser `confirm()` calls (grid vacate, etc.) |
| `EmptyState` | icon, message, CTA | dashed-border empties on dashboard/grid/sites |
| `PageHeader` | title, subtitle?, breadcrumb?, actions slot | top of every dashboard page |
| `Skeleton` | shimmer blocks | replace spinner-only loading on dashboard + grid |
| `Toast` | context + `useToast()`; success/error | new — wire into mutations in Phase E |

Rules for the implementer:
- No new dependencies. Hand-rolled, Tailwind classes inside the components only.
- After extraction, pages should contain almost NO raw color/radius/ring
  classNames — if a page still has `bg-white ring-1 rounded-xl`, extraction
  isn't done.
- Keep `data-testid`s and visible text identical where e2e tests reference them;
  run `make test-e2e` after each page is converted.

**Acceptance:** `grep -r "ring-stone-200" frontend/src/app` returns ~0 hits
(all inside components/ui); e2e suite green.

---

## Phase C — Responsive shell (1 session)

The owner's primary device is a phone in a hallway.

- **≥1024px**: keep sidebar, but restyle: 64px collapsed-icon option not needed;
  just apply new tokens, active state = indigo text + `bg-indigo-50` pill,
  stone separators.
- **<1024px**: sidebar becomes a **bottom tab bar** (Dashboard, Sites, Tenants,
  Pending w/ badge) + slim top bar with page title and owner avatar menu
  (sign out lives there). No hamburger-drawer — tabs are faster one-handed.
- All dashboard pages: `p-8` → `p-4 sm:p-6 lg:p-8`; stat cards 2-col on mobile
  (already ok) but check tenant detail + pending pages for horizontal overflow;
  make tables/lists stack or scroll cleanly at 375px.

**Acceptance:** every page usable at 375×812 with no horizontal scroll;
Playwright viewport spot-check added for dashboard + grid.

---

## Phase D — Hero screens (1–2 sessions)

**D1. Occupancy grid** (the flagship — most of the effort goes here):
- Rooms become **cards** (Card component) with room name, floor badge, and a
  per-room mini-summary ("3/4 occupied · ₹2,400 due").
- Bed cells: fixed-size tiles (~96px wide) with: tenant initials avatar (reuse
  deterministic color from pending page) or dashed outline+plus for vacant;
  tenant first name; status as a **left border stripe (3px) + tinted
  background** (softer than full-saturation chips); overdue beds additionally
  show the amount owed in red `tabular-nums`.
- Legend: sticky under the page header, uses StatusPill.
- Side panel → Drawer component; sections: tenant header w/ avatar → balance
  (big, color-coded) → payment history list → actions. Vacate uses
  ConfirmDialog with a date picker (parity with tenant detail page).
- Add a status **filter row** (click a legend pill to filter beds; "all" resets).

**D2. Dashboard:**
- Stat cards: icon in a tinted square, `tabular-nums` values, delta note line.
  Overdue card gets a red left-stripe when nonzero.
- "Collected this month" gets a thin progress bar (collected/expected).
- Alert banners → one consolidated "Needs attention" Card listing pending
  registrations + payment proofs as rows with count Badges.
- Occupancy bars: color by health (≥90% emerald, else indigo) — this is a
  *utilization* color, not a status color; acceptable exception, note it.

**Acceptance:** grid readable at a glance from 2m away (squint test: status
stripes distinguishable); e2e green; `make review-design` run before/after and
the report attached to the PR.

---

## Phase E — Feedback layer (half a session)

- Wire `useToast()` into every mutation: payment recorded, tenant assigned,
  vacated, approved, rejected, profile saved. Success = quiet stone toast with
  emerald check; errors = red with the API message.
- Replace remaining `confirm()` calls (grep for `confirm(`) with ConfirmDialog.
- Skeletons (from B) on dashboard, grid, tenant detail initial loads.
- Buttons get `loading` state during submits (prevents double-submit too).

**Acceptance:** `grep -rn "confirm(" frontend/src/app` → 0 hits; every
mutation shows a toast.

---

## Out of scope (explicitly)

- Dark mode, theming, and user-configurable colors.
- Tenant portal + public registration redesign — apply tokens/components
  opportunistically but no dedicated pass until owner-side is done.
- Component library dependencies (shadcn/radix). Revisit only if hand-rolled
  Drawer/Modal focus-trapping becomes a bug source.

## Evaluation loop

After each phase: run `make test-e2e`, then `make review-design` (screenshots
every page → Claude vision review in `test-results/design-review.md`). Keep the
before-screenshots from the first run as the baseline for comparison.

## Execution notes for the implementing model

- One phase = one branch = one PR. Never mix extraction (B) with restyling (D).
- If an e2e test breaks on selector/text, fix the test only when the change was
  intentional per this doc; otherwise fix the code.
- When this doc and existing code conflict on visual specifics, this doc wins.
- Conventions that still apply: amounts in paise via `formatCurrency()`; every
  new interactive feature gets a Playwright test.
