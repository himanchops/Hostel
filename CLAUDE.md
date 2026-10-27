# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start PostgreSQL
make db-up

# Run database migrations (install golang-migrate first)
make migrate

# Run backend (localhost:8080)
make backend

# Run frontend (localhost:3000) - requires Node 20+
make frontend

# Build backend binary
make build-backend
```

## Project Structure

```
hostel/
├── backend/
│   ├── cmd/server/          # Main entry point
│   ├── internal/
│   │   ├── auth/            # JWT + bcrypt
│   │   ├── database/        # PostgreSQL connection
│   │   ├── middleware/      # Auth middleware
│   │   └── models/          # Domain models
│   └── migrations/          # SQL migrations
├── frontend/                # Next.js app
└── docker-compose.yml       # PostgreSQL
```

## Current Status

**See `docs/PROGRESS.md` for the full phase-by-phase build log.** Always read this first when resuming a session — it is the canonical handoff document and is kept up to date at the end of every session.

**What's left to do is on the board, not in this repo** (Oct 2026). The list
is `~/Projects/board/lists/hostel.md`, one line per item, and `make board`
draws it as sticky notes. `~/Projects/board/README.md` is the workflow; read it
before adding, finishing or dropping anything. In short:
- An observation goes on the list the moment it comes up, not at the end of
  the session.
- `docs/BACKLOG.md` holds a write-up only when an item needs more than a line,
  under a heading that matches the line's title word for word.
- When an item ships, its write-up moves to `docs/DONE.md` in the same PR, and
  its line comes off the list once the PR merges.

GitHub issues, TODO comments, memory notes and "Deferred" sections are not
task lists.

Current state (Sep 2026): Phases 0–9.1, **design Phases A–F complete**, **Phase 10 (Collections & WhatsApp nudges)** and **Phase 11 (Settlement calculator)** are merged, along with two stabilization passes — **S1 data integrity** (partial stay updates, correctable stays, month-end cycle clamping) and **S2 money-math unit tests** (`computeBedStatus`, dashboard revenue, `formatCurrency`). Deployment is done and the app is live (Phase 9.2–9.6), and **Phase 9.7 wired up error tracking** (Sentry, EU region — `docs/DEPLOYMENT.md` → "Where the logs go"). It is live and verified in both projects (Sep 2026).

**Phase 15 (Insights)** added the app's first historical view — `GET /api/insights?months=N` and `/insights`, with collected-vs-billed by month, occupancy in bed-nights, and a per-room breakdown. No migration: every figure was already derivable from `payments.payment_date` and `stays.start_date`/`end_date`. 15b widened `seed-demo` to 20 beds over 15 months so the charts have a shape; 15c added hover readouts and folding panels; 15d made the dashboard's two lists linkable and bounded. **A real account is on production**: Chopra Boys Hostel, owner #4, site #1, 45 beds — see `docs/DEPLOYMENT.md` → "The live owner account".

**Phase 16** closed the eight items the owner found running the live hostel
(`docs/DONE.md` → "Feedback from running the real hostel", all ✅): delete
guards on rooms and beds, `expected_end_date` + the `departure_due` status
(migration 006), settled stays reading as square, owner-set portal passwords,
renaming rooms and beds, placing a tenant in a bed from the new-tenant form, a
photo on the registration form, and saying out loud that portal login is phone +
password. Four of the last five were a capability the backend already had that
no screen ever offered — check for that before building.

**The UX audit (Sep 2026)** — seven strangers walked the app cold; report in
`docs/UX_REVIEW.md`, its work list is now in `docs/DONE.md` → "Found by the UX audit".
Its three blockers and first two majors are fixed on `ux-audit-blockers`:
deposits are their own payment kind and only money received is refunded
(migration 007), hover-only controls are reachable by touch and keyboard, owners
have `/account` with change-password and sign-out-everywhere backed by token
revocation (migration 008), the tenant ledger has a real button, and Insights
charts fit a phone. A second pass (`audit-majors-round-two`) made the
dashboard's "Collected" stop at today and its "Overdue" count tenants without a
bed, so both agree with Insights and Collections; either sign-out now forgets
both the owner and tenant sessions; and the pending queue stopped promising to
"collect" a deposit it never records. A third (`audit-majors-round-three`) named
the bed on the tenant profile instead of printing its id, made the bed picker
say "loading" before "no sites", labelled each date in Vacating Soon, and gave
the grid an "Owes money" filter that ignores bed status. A fourth
(`audit-round-four`, migration 009) made every control 44px under touch
(`TOUCH_TARGET`, `components/ui/touch.ts`), kept rejected payment proofs with a
reason instead of deleting them, kept tenants who settled short on Collections
under "Moved out — still owes", and let an owner whose session ended sign in
again without losing a half-typed form. What is left of it is on the board.
**Pre-import hardening** (PR #38, migration 010) made uploads private (keys
in the database, presigned links on read; the bucket's public URL is disabled,
verified in production 23 Sep 2026), required the front of
an ID on public registration, and rate-limited logins and registration. The
Aadhaar number stays as typed (decision reversed 23 Sep 2026). **Rent from a date** (migration 011, Oct 2026) made rent changes apply only
from a date onward, added "Delete tenant", shrank photos before upload, and
named the hostel on its registration page. **Tenant notes** (migration 012)
added owner-only free text beside Workplace / College, and
`scripts/import-notebook.py` backfills the paper notebook through the API.
Its data lives in gitignored `.hostel-import/`, and it replaces the old
`cmd/import`, which was broken and wrote to the database directly. Corrections and write-offs still
wait for a dedicated design session (`docs/BACKLOG.md` → "Corrections and
write-offs").

**The primary device is probably an iPad**, in either orientation — which puts
it on both sides of the 1024px sidebar breakpoint. Test layout and interaction
changes at 375×812, 768×1024 and 1024×768, and use touch emulation for the iPad
sizes: width never stands in for "has no mouse".

The rent-terms fields and the vacant-bed picker live in
`frontend/src/components/StayForm.tsx` and had four drifting copies before
Phase 16d. A fifth screen that needs "rent, deposit, cycle, start date" or "pick
a vacant bed" imports them; it does not write them again. The same file holds
"Paid today" (`PaidTodayFields`, `recordPaidToday`): every form that puts
someone in a bed also records what they paid on arrival.

UI work goes through `frontend/src/components/ui/` (design Phase B). New pages must not hand-roll buttons, cards, inputs, drawers or modals, and must not call `window.confirm` — use `useConfirm()`. **The app draws no charts, on purpose, and must not add a charting library.** Insights became tables in Oct 2026 because a chart's numbers sit behind a hover the iPad does not have. Prefer a table, with a `Meter` fill bar where a ratio needs to be seen at a glance. The frontend has four runtime dependencies (react, react-dom, next, @sentry/browser), and a charting library would be a conspicuous addition. If a chart ever comes back, it is hand-rolled SVG (the old `components/ui/Chart.tsx` is in git history), and it measures its container rather than scaling a fixed `viewBox`, which letterboxes a short series into an island of bars. `grep -rn "ring-stone-200" frontend/src/app` must stay at zero. Every mutation shows a toast (`useToast()`), and every failure path surfaces somewhere — inline `FormError` in forms, a toast elsewhere. Every page must work at 375px (design Phase C): sidebar above 1024px, bottom tab bar below. A page's first load shows `PageLoader`, not grey bars or a spinner. It stays invisible for 800ms, so a warm load never shows it, and after 5s it says the server is waking up (Render free plan). A site opens on its grid (`/sites/:id/grid`); room setup (`/sites/:id`) is "Edit rooms". An explanation that is only needed the first time goes behind `WithHelp`'s ⓘ, never as a standing paragraph; a warning that must be read before acting (Delete tenant) stays one short visible line. A rent is worded with `perCycle` ("₹500 a night"), never "/mo" or "/monthly".

Test dirs are `tests/e2e/{owner,tenant,public}/` — a whole surface with no directory is a surface nobody has tested. E2E tests log in with `loginAs(page, token)` from `tests/e2e/helpers/api.ts` — never `goto("/")` then `localStorage.setItem`, which races with the root redirect.

**Roadmap decision (Apr 2026): deployment is deferred until after the UI modernization and two value features.** Execution order: design Phases A–B (`docs/DESIGN_PLAN.md`) → Phase 10 Collections & WhatsApp nudges (`docs/PROGRESS.md`) → design Phases C–E → Phase 11 Settlement calculator → design Phase F → deploy (Phase 9.2–9.6, `docs/DEPLOYMENT.md`).

Key conventions to carry forward:
- **A payment has a kind: rent or deposit** (migration 007). Any query that sums
  payments as rent — dues, balances, collected, arrears, "last payment" — must
  say `p.kind = 'rent'`; there were nine when the column arrived. A deposit is
  held money, never rent collected. A settlement refunds approved deposit
  *payments*, never `stays.deposit_amount`, which is only the figure agreed at
  intake — refunding the agreement is how a tenant who paid nothing was once
  offered their deposit back.
- **A control that hides until hover uses `HOVER_REVEAL`**
  (`components/ui/reveal.ts`), never `hidden group-hover:*` and never a
  width-keyed `sm:opacity-0`. Tailwind v4 applies `hover:` only under
  `@media (hover: hover)`, which a touch iPad does not match, so anything keyed
  off width is invisible on the primary device. `tests/unit/hover-reveal.test.ts`
  fails the build on the old patterns.
- **Owner tokens carry a version** (`owners.token_version`, migration 008),
  checked on every request. Anything that should end sessions — a password
  change, sign-out-everywhere, the psql recovery runbook — increments it.
  Plain sign-out stays local to the device on purpose.
- **Never swallow an error.** A handler that returns 500 must log the underlying
  error first — `c.Logger().Errorf(...)` with enough context to identify the row
  — and a `db.Get`/`db.Select` whose error is discarded is a bug, not a
  shortcut. The tenant portal's payment submission was broken from its first
  commit and nobody could see why, because the only trace was a generic
  "failed to submit payment". Same rule on the frontend: every catch either
  shows the user something or reports it.
- **Controls are 44px under a finger.** Anything tappable uses `TOUCH_TARGET`
  (or `TOUCH_LINK` for a standalone text link) from `components/ui/touch.ts`,
  keyed on `pointer-coarse:` — the shared Button/Input/Select already do.
  `tests/e2e/owner/touch-targets.test.ts` measures every control on every
  screen and fails on anything smaller.
- **Uploaded files are private** (migration 010). A file column (`*_url`)
  stores an object key, never a URL. Anything that returns a tenant or payment
  to a browser goes through `signTenant`/`signPayment` (`handlers/files.go`),
  and anything that accepts a file reference checks `validFileRef`. A new file
  column needs both, or it either ships a raw key (a broken image) or accepts a
  URL from any host.
- **Rent and money are two questions** (`handlers/money.go`). "Collected" is
  rent: rent payments, plus rent a deposit paid off at settlement, less an
  advance handed back. It never includes a deposit. "Net in" is money: every
  approved payment of both kinds, less refunds. Settlements are dated on the
  stay's `end_date`, never `created_at`. Anything that reports collected rent
  or money in by month goes through `loadMoneyByMonth`, so the dashboard and
  Insights cannot drift.
- **When rent is due comes from `dueFor`** (`handlers/due.go`): the oldest
  cycle not fully paid, via `paidThrough`. Screens word it with `lib/due.ts`
  and never work out a due date themselves. "Due soon" is one window,
  `DUE_SOON_DAYS` (`dueSoon`), shared by the grid's amber tiles and the
  Payments screen's "Due this week".
- **The owner's word for money that arrived online is "UPI".** The stored
  `payment_type` stays `online`; every label goes through `payMethodLabel` /
  `PAY_METHODS` (`lib/payMethod.ts`), and every record form uses the same
  Cash / UPI buttons. The screen once called Collections is **Payments**
  (`/payments`, data from `GET /api/payments/board`).
- **Rent can change partway through a stay** (migration 011). Anything that
  bills rent goes through `rentSchedule.billed` (`handlers/rent.go`), never
  `rent_amount × cycles`, which reprices every month already lived. There were
  six such sites when the table arrived (dashboard, grid, Collections,
  Insights, tenant summary, settlements). `stays.rent_amount` is the *latest*
  scheduled rent, good for display and wrong for arithmetic.
- **Moving out is one sheet** (`components/MoveOutSheet.tsx`), from the
  tenant page and the grid alike. Its opening position is the house rules in
  `moveOutSettlement` (`lib/settlement.ts`):
  - rent is never refunded (`advance_returned_paise` 0)
  - the deposit comes back only to someone who gave notice by the start of
    their last rent month (`noticeBy`, `handlers/settlements.go`)
  - the owner can type over the final amount, recorded as a "Changed by you"
    line so the settlement still adds up

  A refund says how it went back (`refund_method`, migration 013).
- **Moving beds keeps the stay** (migration 014). `POST /api/stays/:id/move`
  changes `stays.bed_id` and writes a `stay_moves` row, and the deposit,
  payments and rent day stay put. `stays.bed_id` is always the bed they're in
  *now*. Anything historical that asks "which room was this night, or this
  payment, in?" goes through the moves (`roomSpans`, or the bed the next move
  left), as Insights' "By room" does. A tenant who left and came back
  gets a new stay from their own page (`NewStayDialog`), never a second
  tenant record.
- **A rent change is asked the owner's way** (`handlers/rentplan.go`,
  `components/RentChoice.tsx`): "from next month rent is X; this month they
  pay the old rent / the new rent / an agreed amount", with a line from the
  server (`rent-preview`) saying what it will mean before saving. Move bed
  and Change rent share it. `planRent` turns the answers into rent steps and
  `writeSchedule` saves them. A screen that shows "the current rent" takes it
  from the preview's `this_rent`, never `stays.rent_amount`, which is the
  latest *scheduled* rent.
- **A stay with no bed is a booking** (Oct 2026): someone who paid to hold a
  place and gets a bed on arrival. Nothing on the grid holds a bed for them,
  because the owner promises a place, not a bed. One that ends without ever
  having a bed was cancelled and bills nothing (`endedCycles`). The move-out
  sheet cancels it (`booking` mode), keeping what was paid by default.
- **Approving a registration only approves** (`POST /api/tenants/:id/approve`,
  Oct 2026). The pending drawer then makes the stay and records the money with
  the same calls as Add tenant, and asks the same `Arrival` question
  (`StayForm.tsx`). A daily guest is priced per night: with a leaving date,
  Paid today is nights × rate (`stayNights`, `rentForNights`, `lib/rent.ts`),
  never one amount for the stay. Don't give approve a stay again; that was a second copy of
  `POST /api/stays`. Public registration requires the ID front and an emergency
  contact; owner-created tenants need only name and phone.
- **Phone numbers are Indian mobiles** (Oct 2026): `normalizePhone`
  (`handlers/phone.go`) on every handler that takes one, and `tenDigits` /
  `checkPhones` (`lib/phone.ts`) on every form, so the form says so before
  anything uploads. Store the ten digits. Anything that looks a tenant up by
  phone compares `phoneDigitsSQL`, because older rows keep the shape they were
  typed in.
- **A WhatsApp reminder is built by `nudgeMessage`** (`lib/wa.ts`): firmer
  with lateness (`askToPay`), and carrying the owner's UPI ID when one is set
  (`owners.upi_id`, migration 015). Never a second template.
- **The tenant portal's money is the owner's money.** `/tenant/summary` is
  `loadTenantSummary`, the same function as the owner's tenant page. Never
  give the portal its own arithmetic.
- **A stay that has ended is billed through `cyclesThroughEnd`** (`helpers.go`):
  every cycle that began before the leaving day, never one that starts on it.
  This applies to the settlement, the tenant summary and Insights alike. An
  open stay still bills with `cyclesElapsed`, rent due on the rent day.
- **A rejected payment is kept, never deleted** (migration 009). "Pending" is
  `is_approved = false AND rejected_at IS NULL`; any new query for the pending
  queue must say both.
- **Rent let go is not a payment** (`rent_let_go`, migration 017,
  `handlers/letgo.go`). Anything that works out what someone owes adds it
  to rent paid through `letGoCredit` (never past what was billed), using
  `letGoBeforeSQL` for a stay's billing and `letGoAfterSQL` for a leaver's
  shortfall since the settlement. Nothing that counts cash reads it:
  `total_paid`, Collected and Net in stay what arrived. Insights and the
  dashboard take `loadLetGoByMonth` off a month's expected rent. A new
  "owed" figure that skips it disagrees with the tenant page.
- **A payment is corrected from its sheet** (`components/PaymentSheet.tsx`,
  migration 016), opened by tapping its row on the tenant page or in the bed
  drawer; no row carries its own delete. `PUT /api/payments/:id` keeps the
  old figures in `payment_edits`; the `payments` row is always the current
  truth, so no money query reads the edits. A tenant's payment
  (`from_tenant`) is marked not accepted, never deleted. Anything recorded
  before a settlement is held by it (`notSettledSQL`): change, delete,
  accept and not-accept all refuse until `DELETE /api/stays/:id/settlement`
  takes the settlement off. A new action that changes a payment's money
  carries the same condition.
- **Three dates end a stay, and they are not the same date.** `notice_date` is
  when they told you, `expected_end_date` is when they say they are going,
  `end_date` is when they actually went. Only the last one ends a stay, and
  only a human sets it — nothing acts on `expected_end_date` automatically,
  because tenants overstay and leave early and no query knows which. A passed
  expected date raises `departure_due` (a bed status that outranks arrears) and
  a dashboard prompt; it never frees a bed. Migration 006.
  A leaving date can also be given at move-in (`POST /api/stays`
  `expected_end_date`, Oct 2026), which sets `notice_date` to the start date:
  they told you on arrival. Every screen words the two dates through
  `departureFacts` or `leavingChip` (`lib/due.ts`), never on its own.
- **No capability may be tenant-portal-exclusive.** Anything a tenant can do
  from `/my`, an owner must be able to do from the owner side. This is not
  symmetry for its own sake: a tenant the owner creates by hand never gets a
  `password_hash`, and portal login requires one — so an owner-created tenant
  can never log in, and a portal-exclusive action is unreachable for them
  forever, not merely inconvenient. Recording a vacating notice is the case
  that proved it. See `docs/DONE.md` → "Feedback from running the real
  hostel".
- **Never put a tenant's own data into an error message.** Errors now leave the
  process — `serverError` and `reportError` forward to Sentry — and the scrubber
  there catches Aadhaar numbers, Indian mobile numbers and email addresses by
  pattern, but it cannot catch a *name*: nothing distinguishes "Priya Sharma"
  from "Postgres Error". So `serverError(c, err, "failed to load tenant")`, never
  `fmt.Errorf("failed to load %s", name)`. Structured data is safe regardless —
  request bodies are never collected — so this rule is only about strings we
  build ourselves. See `docs/DEPLOYMENT.md` → "What the scrubber does not cover".
- **Two seed scripts, and only one may point at production.**
  `scripts/seed-demo.py` (`make seed-demo` / `make seed-demo-reset`) invents an
  owner at `demo@seed.invalid` — `.invalid` is reserved by RFC 2606 and cannot
  collide with a real account — and fills it with fiction. It is localhost-only.
  `scripts/seed-chopra.py` (`make seed-hostel`) writes to the **real** account,
  so it is narrowed to match: sites, rooms and beds only, never a tenant, stay or
  payment; never a delete or an update; idempotent on re-run. Rehearse it against
  a local backend (`HOSTEL_API=http://localhost:8080`) before production.
  `seed-demo.py` *can* target a deployed backend — it needs `HOSTEL_API` **and**
  an explicit `--remote`, because an env var outlives the shell command that set
  it. Safe there by construction: the reserved address cannot collide and every
  query is owner-scoped, so it adds an owner beside the real one.
  A seed script must never fall back to logging in when signup fails — that once
  appended ten fake tenants to a live owner's data. Credentials live in
  `.hostel-credentials.env`, gitignored, because **this repo is public**.
  Details: `docs/DEPLOYMENT.md` → "The live owner account".
  A third script, `scripts/import-notebook.py`, *does* write tenants, stays
  and payments to the real account. It only creates, checks everything before
  its first write, and reads every tenant back. Its data never enters git.
- **Tenant notes are owner-only.** The portal's tenant queries name their
  columns and leave `notes` out. Never switch them to `tenantCols`, which
  includes it. `tests/e2e/owner/tenant-notes.test.ts` fails if a note reaches
  `/tenant/me` or tenant login.
- Every new feature ships with a Playwright e2e test in `frontend/tests/e2e/`
- Money math ships with a unit test too — `backend/internal/handlers/*_test.go` or `frontend/tests/unit/`. Exact values, non-degenerate fixtures (see Phase 12a in `docs/PROGRESS.md`)
- Amounts stored in **paise** (₹1 = 100 paise), displayed via `formatCurrency()`
- Go and Node are not on the default PATH in Claude's shell, and the paths differ per laptop — check before assuming. On the Homebrew machines: `export PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH`. Postgres may run natively (`brew services`) rather than via Docker, in which case `make db-up` is a no-op.

## Git Remote

Remote: `git@github.com:himanchops/Hostel.git`

```bash
git remote add origin git@github.com:himanchops/Hostel.git
git push -u origin master
```

This file used to require an SSH host alias, `github-personal`, and to say
plainly "not `git@github.com`". That alias is gone (Sep 2026) and the plain
GitHub host is correct. Noted rather than silently deleted, because the old
instruction was emphatic enough to be worth contradicting once.

---

## Project Overview

Multi-tenant SaaS web application for hostel and PG (paying guest) owners to manage rent tracking and occupancy planning. Core value is a dynamic room grid showing occupancy and payment status with support for irregular usage patterns and backfilled data entries.

## Tech Stack

- **Backend**: Go with Echo framework
- **Frontend**: Next.js with React and TailwindCSS
- **Database**: PostgreSQL with multi-tenant isolation
- **Auth**: JWT with bcrypt password hashing
- **Storage**: S3-compatible for file uploads (tenant photos, ID proofs)
- **Deployment**: Render, Fly.io, or Railway

## Architecture

### Multi-Tenancy Model
Each owner's data must be strictly isolated. All database queries and API endpoints must scope data to the authenticated owner's tenant context.

### Core Entities
- **Owner** - Admin user with full access to their tenant scope
- **HostelSite** - Multiple sites per owner
- **Room/Bed** - Rooms within sites, optionally with individual beds
- **Tenant/Renter** - Occupants
- **Stay** - Occupancy history tracking
- **Payment** - Ledger entries for rent/deposit tracking

### Room Grid States
The primary UI feature uses color coding:
- Occupied & paid (green)
- Occupied & partial payment (yellow)
- Occupied & overdue (red)
- Vacant (gray)
- Vacating soon (orange)

### User Roles
Currently implementing Owner (admin) role only. System should be designed for future Staff and Renter login extensibility.

### Tenant Registration Flow
1. Public QR-link form for tenant self-registration
2. Owner reviews pending registrations
3. Owner approves and assigns room/rent/deposit

### Tenant Portal (Limited Access)
- View payment ledger
- Submit payment proof screenshots
- Submit notice to vacate
- All entries require owner approval