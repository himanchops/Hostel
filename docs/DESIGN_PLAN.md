# UI Modernization Plan

Written after a design review of the frontend (Apr 2026 state: Phases 0–9.1 done).
This doc is the **execution contract**: each phase is independently shippable,
ordered by dependency, and scoped so a smaller model can implement it without
extra design decisions. Do the phases in order. Do not restyle pages before
Phase B is complete.

**Status (Aug 2026): Phases A–D are done**, as is Phase 10 (Collections &
WhatsApp nudges). Next is Phase E (feedback layer). Phase F
(public surfaces) was added later and sits after E — see its own section for
why it is deliberately not part of the A–E sequence.

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

## Phase A — Foundations ✅ (branch `design-phase-a-foundations`)

**Shipped:** body font fixed to Geist (was hardcoded Arial); dark-mode media
block deleted; status tokens defined in `globals.css` as `@theme` custom
properties (`vacant`/`paid`/`partial`/`overdue`/`vacating`, shades 50/100/200/
500/700/800); app background moved to stone-50; project-wide `gray-*` →
`stone-*` (395 occurrences, 17 files); grid `STATUS` record migrated off raw
`green-`/`yellow-`/`red-`/`orange-` onto the new tokens.

Status hues that changed (intentional, per the palette above): **paid**
green → emerald (`#dcfce7` → `#d1fae5` at the 100 step), **partial** yellow →
amber (`#fef9c3` → `#fef3c7`). **overdue** (red), **vacating** (orange), and
**vacant** (stone) resolve to the same hexes as before. Verified in the built
CSS bundle: all `bg-/border-/text-` utilities for the five statuses generate.

**Note for Phase B:** status-colored chips outside the grid (payment-type
badges, pending banners, notice chips on dashboard/pending/tenant pages) still
use raw Tailwind hues. Those become `Badge tone=...` in Phase B — do NOT point
them at the status tokens, which are reserved for bed status.

### Original spec

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

## Phase B — Component kit ✅ (branch `design-phase-b-component-kit`)

**Shipped:** `frontend/src/components/ui/` with all 12 components plus two
additions — `Banner` (the dashboard's tinted alert strips, which otherwise
would have kept raw `bg-amber-50 ring-amber-200` on the page) and `FileInput`
(three pages had hand-rolled `file:` styling). Every owner-side page now
imports from `@/components/ui`; `grep -rn "ring-stone-200" src/app` returns
hits only in the tenant portal and public registration, which this phase
deliberately leaves alone.

Decisions worth knowing:
- **`window.confirm` is gone from owner pages** — `ConfirmProvider` +
  `useConfirm()` return a promise. This was a correctness fix as much as a
  design one: Playwright auto-dismisses native dialogs, so every confirmed
  action silently no-opped in tests.
- **Approve buttons are indigo, not green.** Status hues are reserved for bed
  status, so a green button no longer competes with "paid". Reject uses the
  `danger` variant.
- **Balance tints read the status tokens** (`bg-paid-50` / `bg-overdue-50` on
  the grid drawer and tenant summary) — those genuinely *are* payment status.
  `Badge` tones stay on raw Tailwind hues, per the Phase A note.
- **Cards lost their `shadow-sm`** and standardised on `p-4`, per the density
  and surface rules above. Shadows now appear only on Drawer/Modal/Toast.
- `Toast` is built and mounted but not yet wired into mutations — that is
  Phase E.

### Original spec

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

## Phase C — Responsive shell ✅ (branch `design-phase-c-responsive`)

**Shipped:** sidebar from 1024px up, bottom tab bar below it, sharing one nav
definition. Every owner page is usable at 375×812 with no horizontal scroll and
nothing clipped inside a container.

Decisions worth knowing:
- **The mobile top bar carries the wordmark, not the page title.** The plan
  asked for the title, but every page already opens with its own `<h1>` and the
  tab bar shows which section is active, so a title there just said the same
  thing twice — it read as a bug on screen. Deriving a real title for detail
  pages (a tenant's name) would have meant publishing it from page to layout
  through context, which is a lot of plumbing for a duplicated word.
- **The tenants table becomes a stacked list below `sm`.** Five columns at
  375px wrapped every single cell onto two lines. Same data, one row per
  tenant, table returns at `sm`.
- **Pending's action buttons wrap to their own row** on a phone. They were
  squeezing the tenant's email until it was clipped mid-address.
- Form grids (`grid-cols-2`, `grid-cols-3`) stack below `sm`; `CountBadge`
  gained a `sm` size so tab-bar badges don't crowd their icon.
- The account menu's open state is stored as *the route it was opened on*
  rather than a boolean, so navigating closes it without an effect.

**Test-infrastructure fix that came out of this:** every UI e2e test logged in
with `goto("/")` → `setItem` → `goto(target)`, which races — the first
navigation boots the app unauthenticated and schedules a redirect to `/login`
that can land after the second `goto` and steal it. It had been passing by
luck; two tests started failing about one run in two. Replaced with a shared
`loginAs()` helper using `addInitScript`, which seeds the token before any page
script runs. That touched the two pre-existing test files as well, and took the
suite from flaky-and-46s to stable-and-10s.

### Original spec

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

## Phase D — Hero screens ✅ (branch `design-phase-d-hero-screens`)

**Shipped:** the grid and dashboard rebuilt, plus the typographic character and
empty states from D3.

- **Grid.** Rooms are Cards with a summary line ("2/2 occupied · ₹31,500 due").
  Beds are 96px tiles carrying status as a 3px left stripe over a 50-level tint
  rather than a saturated block — at a distance the stripes are what you read,
  and a wall of full-strength colour is tiring to look at all day. Each tile has
  the tenant's initials avatar (deterministic colour, shared with the pending
  queue), their first name, and the amount owed in red when there is one.
- **The legend is the filter.** Clicking a status pill narrows the grid to those
  beds and drops rooms that have none left; counts sit in the pills, zero
  included, because "Overdue 0" is worth seeing. It sticks below the mobile top
  bar while scrolling.
- **Vacating from the grid can finally backfill a date.** Both the grid and the
  tenant page now render one `EndStayDialog`, so the two paths cannot disagree
  again — this closes the known issue that has been open since S1.
- **Dashboard.** Stat cards get a tinted icon square; "Collected this month"
  gets a progress bar against expected; the overdue card gets a red left stripe
  and becomes a link to Collections when non-zero. The two alert banners became
  one "Needs attention" card. Occupancy bars go emerald above 90% — utilisation,
  not bed status, and the one deliberate exception to "green means paid".
- **Typography (D3).** Fraunces for the wordmark and page titles only; Geist
  keeps every number, table cell and form control. Titles scale 22px → 26px at
  `sm` so a serif headline doesn't eat a phone screen.
- **Empty states (D3).** All nine now carry an icon, a title and — where there
  is an obvious next step — a button that does it.
- **Icons moved to `components/ui/icons.tsx`.** A bed and a rupee had already
  been duplicated across the grid, the dashboard and the shell, and an icon that
  differs by a stroke width between screens looks like a bug.

**Note:** `make review-design` was not run — it needs `ANTHROPIC_API_KEY`, which
this environment doesn't have. Before/after screenshots were taken by hand at
1280px and 375px instead.

### Original spec

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

**D3. Typographic character + empty states** (small; do it last, after D1/D2):
- The app sets Geist everywhere. That is right for data — neutral, tabular
  figures — but it is also the default of every AI-era dev tool, so the app
  currently has no identity of its own. Give the **wordmark and page titles** a
  display face with some character; leave Geist on every number, table cell and
  form control. Contained to `PageHeader` and the sidebar logo. Do not touch
  body or data type, and do not add a third family.
- `EmptyState` accepts an `icon` prop that **no page passes** — every empty
  state in the app is a bare grey sentence today. Give each one an icon, and a
  CTA where there is an obvious next step: no sites, no rooms, no beds, no
  tenants, no stays, no payments, no pending registrations. "Everyone is paid
  up 🎉" (Phase 10) is the tone to match.

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

## Phase F — Public surfaces (1 session)

The screens a stranger sees: `/register/[ownerId]` and its success state,
with `/my/login` as the lesser sibling. These are still Phase-0 code — local
`inputCls`/`labelCls` constants, `ring-stone-200` cards, no kit imports at all.

Two jobs, strictly in this order:

1. **Convert to the kit** — `Card`, `Field`/`Input`/`FileInput`, `Button`,
   `FormError`. Mechanical, same as Phase B. After this,
   `grep -rn "ring-stone-200" frontend/src/app` returns zero hits anywhere,
   which is the Phase B acceptance test finally finished.
2. **Then give it character.** This is the one surface in the product where
   "make it visually interesting" is the right instinct — distinctive type, a
   committed palette, a little motion, decorative detail. It is a first
   impression, not a work surface: a prospective tenant scanning a QR code in a
   corridor is deciding whether this place looks legitimate. Constraints still
   hold — no dark mode, one accent — and **the form itself stays boring and
   legible**. Character goes in the frame around it (header, background,
   success screen), never in the inputs.

Why this is separate from A–E: everything before it optimises for scan speed
for a daily user. This page optimises for trust from a first-time one. Those
are different jobs and should not share a checklist.

**Acceptance:** registration completes end-to-end at 375px; the success screen
is worth screenshotting; zero raw ring/radius/colour classNames left in
`src/app`.

---

## Out of scope (explicitly)

- Dark mode, theming, and user-configurable colors.
- The logged-in tenant portal (`/my`) beyond kit conversion — the owner is the
  paying user and gets the design attention. (Public registration is no longer
  out of scope: it graduated to Phase F.)
- Component library dependencies (shadcn/radix). Revisit only if hand-rolled
  Drawer/Modal focus-trapping becomes a bug source.
- **Decorative layout tricks** — asymmetry, broken grids, overlapping elements,
  textures, gradient washes. Considered and rejected in Aug 2026, from a
  design-guidance list making the rounds. That advice is written for marketing
  sites; here the grid *is* the product and scan speed beats visual interest on
  every owner-facing screen. The parts of that list that did survive are D3
  (typography) and Phase F (the one page where it genuinely applies).

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
