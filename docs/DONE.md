# Done

What is no longer pending: shipped, decided against, or overtaken. Nothing in
this file is waiting to be done; the list of what is left is
`~/Projects/board/lists/hostel.md` (see `~/Projects/board/README.md`).

`docs/PROGRESS.md` stays the record of what each PR built. This file keeps the
write-ups that explained *why*, so a closed question is not argued again.

---

## Shipped since the board (newest first)

When an item with a write-up ships, its write-up moves here from
`docs/BACKLOG.md` in the same PR, under a heading with the PR number:
`### <title> (#NN)`. Items with no write-up just leave the board.

### Letting owed money go (#63)
Shipped 27 Oct 2026, the second and last part of "Corrections and
write-offs", as the owner agreed it that day (he chose to cover leavers too):
- A quiet "Let some go…" under the tenant page's balance opens a dialog
  filled in with everything owed, which the owner lowers; a live line says
  "Varun will owe ₹14,000 instead of ₹18,000". An optional note.
- It is `rent_let_go` (migration 017), never a payment. What someone owes
  counts it like rent paid, oldest month first, on the tenant page, the
  grid, Payments, the dashboard, the reminder, Change rent and the
  settlement. Collected and every cash figure ignore it. It can bring what
  they owe to zero, never below (`letGoCredit`).
- For someone who left owing, an amount let go after the settlement comes
  off what they still owe, and they drop off "Moved out — still owes".
- A muted "₹4,000 let go · Diwali" line in the ledger and the bed drawer
  opens a sheet with Take back. One a settlement was worked out from waits
  for that settlement to be undone.
- Insights: the month it came off expects that much less, and the month's
  lines end with a quiet "Let go, not collected: ₹4,000 Varun". No column,
  as the owner asked.

The write-up as agreed:

What is left of "Corrections and write-offs" after #62 shipped correcting a
payment. "They owe ₹10,000, we're letting it go", while they are still
staying; at move-out, "Changed by you" in the move-out sheet already does it,
and the owner is happy with how that reads (27 Oct 2026).

**Decided with the owner, 27 Oct 2026:**
- A quiet "Let some go…" link inside the tenant page's "Owes ₹X" line. It is
  rare, so nothing beside "Record payment" and nothing on every ledger.
- It records that ₹Y of a given month is forgiven, so it stops showing as
  owed on Payments, the grid and a settlement. It is never a payment: Collected,
  the dashboard and Insights' collected figures stay cash.
- Insights: only if it can sit there quietly, a muted line rather than a
  column. The owner said it may not be needed at all, since this is rare.

**How (proposed, not built):** a per-cycle adjustment to *billed* rent applied
inside `rentSchedule.billed`, not a third payment kind: a `waiver` kind would
make every `kind = 'rent'` query decide whether it means "owed" or "cash".
Whatever is built has to reach `loadMoneyByMonth`, because Insights already
reads a shortfall waived at settlement as unpaid, while rent a deposit paid off
at settlement counts as collected (`money.go` → `settlementRent`). Unit tests
with exact figures, like every money change.

### Corrections and write-offs: correcting a payment (#62)
Shipped in part, 27 Oct 2026. The owner agreed the design that day:
- **A payment opens from its row** (`PaymentSheet`, tenant page and bed
  drawer alike) instead of a ✕ on every row. The owner's own entry can be
  changed (amount, rent or deposit, Cash or UPI, date, note) or deleted. A
  change keeps what it said before (`payment_edits`, migration 016), and the
  row says "Changed 27 Oct" with "was ₹8,000" in the sheet.
- **A tenant's payment is never deleted** (`payments.from_tenant`,
  migration 016): "Not accepted after all", with a reason, and "Accept after
  all" back again.
- **A settlement holds its payments.** Anything recorded before a
  settlement can't change until "Undo settlement…" on the settlement card
  takes it off. The stay stays ended, and "Settle the money" settles again.
- **Payments on an ended stay:** "+ Add payment" shows on every stay.
- **Settling asks once more**, naming the person and the amount.
- **Not built, the owner's call:** an Undo on the "Recorded" toast. A
  misclick is fixed from the sheet, and an undo is itself one tap from a
  misclick.
- **The "hard to read" corrections** of September were reworked since; the
  owner is happy with "Changed by you" as it is.

What is left is writing money off, now "Letting owed money go" in
`docs/BACKLOG.md`. The original write-up:

Entry is easy on every screen; correction is absent on most. The owner wants
to talk the design through before any of it is built, and to rethink how
corrections look rather than bolt on buttons (23 Sep 2026). The session has
to cover:

1. **Writing money off: a discount or a waiver.** "They owe ₹10,000, we're
   letting it go." Once waived it must stop showing as owed, on Payments and in
   a settlement. It is **rare**, so it must **not be prominent**: no button
   beside "Record payment" on every ledger. It must never count as money
   collected, so the dashboard, Insights and "Collected" stay cash.
   (Proposed and not adopted: a third payment kind, `waiver`. It is
   mechanically simple, but every `kind = 'rent'` query would need a decision
   about whether it means "owed" or "cash".)
2. **Corrections should be understandable at a glance.** The owner finds the
   current way of recording corrections hard to read. This is a redesign
   question, not a list of missing buttons.
3. **What's missing today:** edit a payment (delete-and-re-add is the only
   correction), undo a recorded payment, undo a settlement, a confirm step on
   settling, un-approve a payment proof. Approving clears a rejection already,
   so a changed mind about a rejected proof is one API call no screen offers.
   The session decides which of these the redesign absorbs.
4. **An ended stay's ledger is lopsided** (owner, 23 Oct 2026). Once someone
   has moved out, the tenant page lets you delete a payment but not add one:
   "+ Add payment" shows only on an active stay, while every row keeps its
   delete. Adding is the useful one, e.g. a payment remembered after they
   left. Deleting is the risky one: after a settlement it changes the balance
   behind figures the settlement already stored. Owing leavers can be paid
   from Payments → "Moved out — still owes", but nothing else can. Decide both
   directions together.
5. **Insights reads a waived shortfall as unpaid.** Rent a deposit paid off at
   settlement already counts as collected (`money.go` → `settlementRent`), but a
   shortfall let go by an adjustment does not, so a stay settled square still
   reads as unpaid there. Whatever the waiver design decides has to reach
   `loadMoneyByMonth`.

The template for the safety side is the owner's "Reset portal password"
dialog, which already does confirm, reveal and honest framing.

### A loader between pages (#60)
Owner, 24 Oct 2026, after #51. `PageLoader` covers a slow API response, and
it is in the HTML each page sends, so it shows even before the app's code
has run. The one gap left is a client-side tap from one page to another
while the next page's code is still downloading: the old page stays on
screen with no feedback. In production Next.js prefetches links in view, so
this is usually instant, but on weak mobile data it may be the "tapped the
site and nothing happened" the owner felt.

The fix is a `loading.tsx` in the `(dashboard)` segment that renders
`PageLoader`, with the same 800ms hold so a quick tap still shows nothing.
Read `node_modules/next/dist/docs/` on `loading.tsx` first (this Next.js
differs from older versions). The local dev server makes the gap look far
worse ("Rendering…" while it compiles each page), so judge it on a production
build. The owner deferred it.

Shipped 27 Oct 2026 in two parts, measured on a production build with the
network throttled (1.5 s latency, 20 KB/s): the tapped nav icon pulses at
once (`useLinkStatus`), and `app/(dashboard)/loading.tsx` shows `PageLoader`
once its own small download lands, about two seconds in. Before, the old
page sat untouched until the new one arrived.

### Empty nights in "By room" (#56)
Insights → By room shows "Empty nights" per room for the range: 168 for a
9-bed room over a 1m range is accurate (bed-nights not slept in) and means
nothing at a glance. Options to put to the owner:
- **Empty now:** "8 of 9 beds empty" today. Concrete, and what he would act on.
- **Rent missed (estimate):** empty bed-nights × that room's average nightly
  rent. In money terms, but an estimate, and it must say so.
- **Average beds empty:** empty nights ÷ days in range, e.g. "5.6 beds".
  Closest to the current figure, still abstract.
- Or drop the column: occupancy % already carries it.

Lean: "Empty now", possibly with occupancy % covering the history. Raised by
the owner looking at 1m on production (Oct 2026).

Decided 27 Oct 2026: beds occupied today, "7 of 9", under "Occupied". No
rent missed, no empty nights. The occupancy % stays, with one line under the
table: "Occupancy is averaged over every night in these months."

### Dashboard "expected" drops someone who left this month (#56)
The tile's "of ₹X expected" sums open stays only, so a tenant who left on the
12th drops out of it, while their rent for this month was billed and Insights
still counts it. Once leavers are settled, the tile reads over 100%
(rehearsal: "₹75,000 of ₹69,500 expected"). Expected should count every stay
billed this month, ended or not; overdue must keep counting open stays only.
Found while building the money table; left alone because overdue shares the
query.

### A "Leaving on" date when someone moves in (#55)
Raised 23 Oct 2026, for later. Some stays are short and agreed up front: a
guest for five nights, or someone who says at the door they're here for one
month. The forms could take a "Leaving on" date with the terms. That would
fill in Paid today as the whole stay (nights × rate for a daily guest), and a
guest paid up to that date would stop showing as owing every morning. The
owner thought it might apply to any stay, not only daily ones.

Open question, not answered yet: is a nightly guest priced per night or as one
amount for the stay?

Answered 26 Oct 2026: per night. A nightly guest's Paid today is nights ×
rate; a monthly or weekly stay keeps one period, with the date saved.

### A returning tenant can start a new stay (#52)
A returning tenant can be given a new stay today, but only from Sites → grid →
a vacant bed → search their name. Their own page, where the owner looks, has no
"Start a new stay" once the last one ended; it should, reusing `StayForm`'s
bed picker and terms.

Worse, nothing stops a *second* record for the same person, so the history
splits in two. Approving a registration now warns "Same number as …" and links
to that tenant (Oct 2026). Still to do:
- the owner's Add tenant form checks the phone too, and offers "this is
  <name>, open their page"
- linking two records that already exist

Tenant login tries every record with that number, newest first, and the
password decides, so duplicates no longer sign in at random. Two records with
the same password still sign in to the newer. Raised by the owner looking at a
settled demo tenant (Oct 2026).

Shipped in #52: "Start a new stay" on the tenant page, and Add tenant warns
"Same number as …" with a link to their page. Linking records that already
exist is still on the board.

---

## Dropped

Decided against or overtaken. Each says why, so it is not raised again.

### Undo a recorded payment
**Dropped 27 Oct 2026, the owner's call:** a misclick is fixed by opening
the payment and changing or deleting it (#62), and an Undo on the toast
risks being the misclick itself.

### A list of every payment
**Dropped 27 Oct 2026, the owner's call:** Insights already lists every
payment, by month. The original write-up:

The Sep 2026 UX audit: a tester asked "show me all the payments I received this
month", hit "Only the 10 most recent payments are shown", and could not tell
whether September had 10 payments or 30. There is still no `GET /api/payments`.

Since then, Insights became a month table where tapping a month lists every
line in it, and Payments covers who owes. Check with the owner whether that
already answers the question before building a page. If it does not: an
owner-scoped, paginated payments endpoint and a page to match.

### Link two records of the same person
**Dropped 27 Oct 2026, the owner's call**, made while clearing the board.
New duplicates are already stopped by "Same number as …" on Add tenant and
on approving a registration. The original write-up:

Before #52, nothing stopped a second record for someone who came back, so
some people may already have their history split across two tenants. Add
tenant and approving a registration now both warn "Same number as …", which
stops new duplicates, but nothing merges two records that already exist.

Tenant login tries every record with that number, newest first, and the
password decides, so duplicates don't sign in at random. Two records with the
same password still sign in to the newer.

### Send the registration link to a tenant added by hand
**Dropped 27 Oct 2026, the owner's call**, made while clearing the board.
The owner can still set a portal password from the tenant page (Phase 16).

### Import the rest of the notebook
**Dropped 27 Oct 2026, the owner's call**, made while clearing the board.
The first batch went in on 21 Oct with `scripts/import-notebook.py`.

### Discounts: a price agreed in advance, or money let go after
**Dropped 26 Oct 2026, the owner's call:** "the amount you agreed thing
works". "An amount you agreed" in Change rent and Move bed (#52) bills a
discount set before the month, such as ₹8,000 this month and ₹9,000 after,
with nothing showing as owed. Letting owed money go after the fact stays with
"Corrections and write-offs". The original write-up:

Owner, 24 Oct 2026: "8,000 instead of 9,000 for the first month", or "8,500
this month and next, then 8,700", without anything showing as owed. Two
different things:
- **Agreed before the month:** that's a price, and Change rent from a date
  already bills it exactly (one step per change). The gaps are that it can't
  be set while adding the tenant, and it reads as a rent change, not a
  discount. Does the owner want the word "discount" on screen?
- **Decided after ("let the ₹1,000 go"):** forgiving money that is owed. A
  per-cycle adjustment to *billed* rent, applied inside `rentSchedule.billed`,
  would lower what's owed without touching what was collected. That avoids
  the waiver-as-payment trap in "Corrections and write-offs", and belongs
  with that design session.

The owner wanted to talk both through before anything is built.

### Automated design review
Dropped 26 Oct 2026. Its own note said it was worth building only while design
phases were still landing, and Phases E and F are done. The idea, as it was:


**The idea:** screenshot every page at 1280px and 375px with Playwright, send
the images to Claude's vision API with the "Design direction" section of
`docs/DESIGN_PLAN.md` as the rubric, and write the critique to
`test-results/design-review.md`. Run it before and after each design phase and
diff the two — a second pair of eyes on work that no test can assert.

**Status (Aug 2026): removed, not written.** `make review-design` existed as a
Makefile target from Phase 6 and `docs/` described the script as shipped, but
`scripts/review-design.ts` was never committed — the Phase 5–6 commit
(`6234f1c`) adds only `fix-tests.ts` and the package files. The target guarded
on `ANTHROPIC_API_KEY` and would then have failed on a missing file, which is
exactly the sort of trap that costs someone twenty minutes. Target, npm script,
and the now-unused `@anthropic-ai/sdk` dependency have been removed.

**To build it** (roughly 80 lines in `scripts/review-design.ts`, plus putting
the SDK dependency back):
1. Reuse the Playwright setup to visit each owner route at both viewports and
   save PNGs.
2. Base64 the images into one `messages.create` call with the design direction
   as the rubric.
3. Write the response to `test-results/design-review.md`, and restore the
   `review-design` Makefile target with its `ANTHROPIC_API_KEY` guard.

**Worth it when** design phases are still landing and the before/after
comparison earns its keep. Phases E and F are the last two, so if it does not
get built before those, it probably should not be built at all.

### Keeping the backend awake on Render's paid plan
The owner chose to stay on the free plan (24 Oct 2026). Since #51, a slow first
load shows `PageLoader`, which says the server is waking up after 5s.

### Softening "stored securely" under the Aadhaar field
Overtaken: the sentence is no longer on the form, and the ID images it was
really about are private since migration 010.

### The settlement's "billed up to this date" wording, and adjustments not shown
Overtaken by the move-out sheet (#46): the owner's changes show as a "Changed
by you" line, so the settlement adds up on screen.

### A tenant withdrawing their own notice
Done in #50: the portal's notice panel has Change date and Withdraw notice.

---

## Archive: the backlog before 26 Oct 2026

The whole closed half of the old `docs/BACKLOG.md`, unedited apart from heading
levels. Some entries end "Still open: …". On 26 Oct 2026 every such remainder
became a line on the board, so nothing below is pending.

### Found by the UX audit (Sep 2026)

Seven testers walked the app cold — no source, no access to this file — as
personas with a job to do (`docs/UX_REVIEW.md` has the method, the themes and
the full ranked list). Hit counts below are how many found the same thing
**independently**, which is why some small-looking items rank high.

Two things this round taught, before the items:

**The old lesson again, inverted.** Phase 16 closed seven capabilities the code
had and no screen offered. This round, four testers reported "there is no way to
record a payment from the tenant page" — and the button is right there at
`tenants/[id]/page.tsx:694`, behind an expander whose only affordance is
`cursor-pointer`, which does not exist on a touchscreen. A shipped feature that
five people cannot find is indistinguishable from a missing one. Grep before
believing either claim, including one of ours.

**A regression test can pass because of the bug.** `insights.test.ts` asserts
`documentElement.scrollWidth - clientWidth <= 1` at 375px — which
`overflow-x-hidden` guarantees *by clipping the thing it was meant to protect*.
It also runs against a fresh owner with no data, so it never renders a chart.
✅ Both halves fixed with the `min-w-0` (Sep 2026) — and the new test was run
against the unfixed page first, to see it fail there (right edge at 708px).

#### ~~Settling a stay refunds a deposit that may never have been paid~~ ✅ fixed — migration 007
**Fixed (Sep 2026, `ux-audit-blockers`).** The fix as written assumed "recorded
deposit payments" existed. They did not: every payment counted as rent in nine
queries, so a deposit written down as a payment was refunded twice — once from
the agreed term, once as "rent paid in advance". `payments.kind` (`rent` |
`deposit`) now separates them, every rent sum filters `kind = 'rent'`, the
settlement refunds approved deposit payments only, and the drawer shows
"₹16,000 agreed · ₹0 received" when they differ. Details in `docs/PROGRESS.md`.
The original report:


`settlements.go:226,232,318` feed `stay.DepositAmount` — the deposit agreed as a
rent *term* at intake — into `refundFor()` as money held. A tenant created with a
₹16,000 deposit who has paid nothing is offered a ₹8,000 refund. It is
irreversible, has no confirmation step, and the tenant profile shows no deposit
to check against. Compute held deposit from recorded deposit payments; show
"₹16,000 agreed · ₹0 received" when the two differ.

#### ~~The hover-only fix was applied to one file of four~~ ✅ fixed
**Fixed (Sep 2026).** And the one "correct" copy was not: `sm:opacity-0
sm:group-hover:opacity-100` keys off width, an iPad is wider than `sm`, and
Tailwind v4 only applies `group-hover` under `@media (hover: hover)` — so on
the primary device the bed controls were invisible. All four now use
`HOVER_REVEAL` (`components/ui/reveal.ts`), which hides only when the pointer is
fine; a unit test bans the old patterns in source. Still open from this item:
there is no *edit* for a payment — delete-and-re-add remains the correction.
The original report:

Phase 16c fixed the bed chip with `sm:opacity-0 sm:group-hover:opacity-100` plus
`focus-visible:opacity-100`. Three destructive controls still use the bare old
pattern and are `display:none` on touch and unreachable by keyboard:
`sites/page.tsx:149` (delete a site), `sites/[id]/grid/page.tsx:684` and
`tenants/[id]/page.tsx:772` (delete a payment). Since there is no *edit* for a
payment either, delete-and-re-add is the only way to fix a wrong amount — so on
a phone, correcting a money mistake is not hard, it is impossible. The recipe is
already in the repo; this is three one-line changes and a shared decision about
edit.

#### The tenant profile is a worse copy of the grid's bed drawer — M, 5 hits
The page named after the person shows `Bed #31` instead of `Room 202 · 1L`,
shows `Paid —` for a tenant who has paid ₹1,27,500, shows no deposit, and hides
the ledger behind the invisible expander above. The `Paid —` is not a data bug —
Phase 11 chose the dash over a false `₹0` precisely because the ledger loads on
expand (`PROGRESS.md`). It is right until the expander becomes undiscoverable,
at which point the placeholder is all anyone ever sees. The grid drawer — same tenant,
same data — has all of it. Five testers arriving by five routes each concluded
the profile was broken. Reuse the drawer's ledger component.

**Partly fixed (Sep 2026).** The expander is a real `<button>` with a chevron
and a payment count, open by default for a single stay (M1); every ledger loads
with the page, so `Paid —` lasts only as long as the request; and the stay card
now shows the deposit, agreed against received. The bed is named "Room 202 ·
1L" rather than `Bed #31` (M7, round three). Still open: converging on one
ledger component with the drawer.

#### Three roll-ups disagree, and no tile says how it was computed — S each
The per-tenant engine is correct (Insights reconciles exactly three ways). The
summaries do not:
- **Collected this month**: dashboard ₹69,900 vs Insights ₹53,600. `dashboard.go:218`
  bounds the month but never caps at today, so two future-dated payments count.
- **Overdue**: dashboard ₹40,400 vs Collections ₹47,900 — the bed-less tenant,
  already logged under "Correctness / consistency" below and now independently
  rediscovered on a link that reads "chase it from Collections".
- **Occupancy**: 65% (beds today) vs 61% (bed-nights), both labelled "now".
Insights footnotes its methods and is the one nobody questioned; the dashboard
footnotes nothing.

**Two of three fixed (Sep 2026, `audit-majors-round-two`):** "Collected this
month" now stops at today, the same rule as Insights, and owner payments dated
more than a day ahead are refused; "Overdue" now counts tenants without a bed,
so it equals Collections to the paisa. Still open: the two occupancy figures,
and a sentence under each tile saying how it was computed.

#### ~~Insights charts are drawn off-screen at 375px and cannot be reached~~ ✅ fixed
**Fixed (Sep 2026)** with `min-w-0` on the card. `insights.test.ts` now seeds a
year and asserts the scroller sits inside the screen and scrolls to the latest
month, at 375, 768 and 1024px. The original report:

Measured: chart 672px wide, right edge at 704, `document.scrollWidth` pinned at
375. **`ChartScroll` is correct** — the failure is above it. The grid item never
shrinks (default `min-width:auto`), so the card grows to 704px and the scroller
ends up 680 wide with 680 of content, i.e. nothing to scroll; `<main>`'s
`overflow-x-hidden` then clips it. One `min-w-0` on the grid item fixes it, and
that recipe is already twice in this layout's ancestor chain. The recent months
— the whole story in the data — are the part cut off.

#### ~~The grid's "Overdue" filter hides the largest debt in the building~~ ✅ fixed (Sep 2026)
An "Owes money" chip filters on balance, whatever the bed's status, with the
total beside it. The original report:

A tenant 70 days in arrears who has given notice is filed under `Vacating`, so
HSR's chip reads `Overdue 0` while she owes ₹17,000. The precedence is
deliberate (`grid.go:31-35`) and right for a bed's *colour*; inheriting it for
the *filter* means the chips surface ₹19,500 of ₹47,900. Wants an "owes money"
filter that ignores lifecycle status.

#### ~~Owner sign-out leaves the tenant session signed in~~ ✅ fixed (Sep 2026)
Either sign-out now forgets both sessions — `lib/session.ts` owns the two keys.
The original report:

`auth.tsx:61` clears only `hostel_token`. A tester signed the owner out, opened
`/my`, and landed in a tenant's ledger. Front-desk machines are shared. Clear
both keys on either sign-out.

#### ~~A rejected payment proof is deleted and the tenant is never told~~ ✅ fixed — migration 009
**Fixed (Sep 2026, `audit-round-four`).** `payments.rejected_at` and
`rejection_reason`; `POST /api/payments/:id/reject` keeps the row and records an
optional reason, which both ledgers show beside a "Not accepted" badge. Pending
now means `is_approved = false AND rejected_at IS NULL` — the queue and the
dashboard count both ask that. Only a waiting proof can be rejected (409
otherwise); approving clears a rejection, so a changed mind is one API call,
though no screen offers it yet. The original report:

The confirm says "Reject and delete" and means it: the row vanishes from the
tenant's history with no status, no reason, no evidence they ever submitted it.
Soft-reject with a "Not accepted" status instead.

#### ~~Settling a tenant erases what they still owe from Collections~~ ✅ fixed (Sep 2026)
Settled stays whose refund was negative stay on Collections under "Moved out —
still owes", with their own nudge wording, and inside the dashboard's Overdue
(with an "incl. ₹X from tenants who moved out" note so the tile still agrees
with the page it links to). What they owe is the settlement's shortfall less
anything paid on the stay **after** the settlement was recorded
(`settledOwed`), which also fixed the tenant page reading a paid-off shortfall
as still owed. Only settled stays: a stay ended without settling has no agreed
figure yet, and a data import of past tenants would otherwise flood the list
with guesses. The original report:

A settlement that leaves the tenant ₹5,500 down removes them from the chase list
and the dashboard total. The tenant who has already left is the one most likely
to skip. Keep settled stays with a balance under "Moved out — still owes".

#### ~~An empty state claims "No sites yet" while sites are loading~~ ✅ fixed (Sep 2026)
`BedPicker` says "Loading your sites…" first, and a failed load now says so
instead of reading as "no sites". The original report:

Three seconds of confident, actionable, wrong instruction on `/tenants/new`,
shown to an owner who has two sites. Render loading before empty.

#### ~~Touch targets are under 44px almost everywhere~~ ✅ fixed (Sep 2026)
`TOUCH_TARGET` / `TOUCH_LINK` (`components/ui/touch.ts`), keyed on
`pointer-coarse:` rather than width, are in Button, Input, Select, FileInput,
SegmentedControl, the drawer and modal Close, breadcrumbs and the status chips;
the rest were hand-rolled and fixed in place. The three stay actions are now a
row of real buttons with settling set apart on the right. A mouse keeps the
compact layout. `tests/e2e/owner/touch-targets.test.ts` measures every control
on every screen at 768×1024, 1024×768 and 375×812 with touch, so a new screen
that forgets fails the build. The original report:

Nudge 32px, inputs 38px, room rename/delete 24px with **zero** gap between them,
portal Sign out 20px, the three stay actions 16px text links 12px apart — one of
which irreversibly settles a deposit. Best fixed once as a minimum height on the
shared `Button` / `Input` / chip components below `lg:`.

#### ~~A session that ends mid-form says "invalid token" and strands you~~ ✅ fixed (Sep 2026)
UX audit M10. Any owner 401 now fires `OWNER_SESSION_ENDED`; the form's error
says "You were signed out … what you typed is still here", and the signed-in
layout opens a sign-in-again dialog over the page, so the form underneath is
never unmounted. A cold load with no session goes to `/login?next=…`, which
returns there after sign-in (`safeNext` refuses anything that is not a path on
this site). Tenant-portal sessions do not get this yet — the portal's forms are
short, and it is a copy of the same pattern when wanted.

#### ~~"Vacating Soon" shows two different dates under one heading~~ ✅ fixed (Sep 2026)
Each row now reads "Gave notice 1 Aug 2026 · leaving 8 Oct 2026" (or "no
leaving date yet", or "was due to leave …" with Confirm departure). The
tenant page's own stay badge still says "Notice 2026-08-01" — labelled, but in
the old date format. The original report:

`Notice: 2026-08-31` beside `Leaving 2026-09-30`, unlabelled. Three testers read
the first as "he left nine days ago" and one said he would have re-let the bed.
The `RecordNoticeDialog` explains this distinction better than anything else in
the product; the dashboard throws it away. Render them as distinct sentences.

#### The public half did not get the owner half's care — S each
Raw lowercase server strings (`invalid phone or password`, `registration link
not found`) against the owner side's `Enter the rent amount.`; phone and Aadhaar
accept any characters; a duplicate registration is silently accepted and sorts
*above* the complete one; `/register/999999` renders the whole form and only
404s after three photo uploads; validation errors paint at the top of the form
while focus jumps to the bottom. Also: an unapproved tenant who follows the
success screen's own link is told "invalid phone or password", which is the
wrong answer to a correct password.
*Phone numbers are fixed on `tenant-portal` (Oct 2026): every form takes an
Indian mobile only, with +91, 0, spaces and dashes allowed, and stores the ten
digits. Aadhaar still accepts any characters.*

#### The tenant portal is a stub wearing the product's logo — M, mostly done
No balance (the number is already computed and correct on the owner's screen for
the same tenant), no deposit, no headings at all, no way to contact the owner,
no payment date or method field (*method done*), and its two forms are visibly from different
eras. `/my/page.tsx` was untouched by Phase 16.
*Done on `tenant-portal` (Oct 2026): what they owe and when, and the deposit,
from the owner's own summary (`GET /tenant/summary`); the hostel's name in the
header; "You're approved" and "Couldn't load" instead of "No stays found";
bookings read as bookings; "Record a payment" takes cash or UPI and fills in
the amount; notice to vacate has its own panel, with Change date and Withdraw
notice. Left, on purpose: a way to reach the owner, the notice rule
("give notice by … to get your deposit back"), a refund line after moving out,
and tenants changing their own password. He chose to wait on all four.*

#### ~~Found running the live account (Oct 2026)~~ ✅ fixed on `rent-from-a-date`
- ~~The registration page said "Register with Lata Chopra"~~: it names the
  hostel now when the owner has one site, and falls back to the owner's name
  with several, until links are per site.
- ~~Photos were stored at full camera size (3024px, several MB)~~: the browser
  shrinks images to 1600px on the long edge before upload (`lib/shrinkImage.ts`).
  PDFs are untouched. Photos already uploaded stay as they are.
- ~~There was no way to delete a tenant~~: "Delete tenant" sits at the foot of
  the tenant page, with a confirmation that counts the stays and payments it
  removes.

#### Running it daily: keep the backend awake, and back it up — ops, not code
Found in the live walkthrough on 21 Oct 2026, the day real use began.
- **Render's free plan sleeps after 15 minutes idle**, so the first request
  after that takes 20–30 seconds (22s measured). On the iPad, the first open of
  the day looks broken. The `starter` plan (~$7/month, `render.yaml` → `plan`)
  keeps it awake. This is the owner's call. **He chose to stay free (24 Oct
  2026).** Since #51, a slow load shows `PageLoader`, which says the server is
  waking up after 5s, so the wait reads as expected rather than broken.
- **Backups:** the only copy is Neon's own restore history, which on the free
  plan covers hours, not weeks (check the exact window in the Neon dashboard).
  Now that the data is real, a scheduled `pg_dump` from the owner's laptop is
  worth having. The script must not need `NEON_URL` on Claude's side.

#### Insights ignores settlements — S, half fixed
**Half fixed (Oct 2026):** rent that a held deposit paid off at settlement now
counts as rent collected on the day the tenant left (`money.go`
→ `settlementRent`), and so does an advance handed back (subtracted). Still
open: a shortfall let go by an adjustment (a waiver) still reads as unpaid,
which is the corrections design's question. The original report:

Insights' "collected of billed" sums rent billed and rent paid, and nothing
else. A stay settled square, with its shortfall absorbed by an adjustment,
still reads as unpaid there. On the live account, a one-day test stay made
"50% collected" read worse than reality. Collections and the tenant summary
already respect settlements (`settledOwed`). This belongs with the corrections
and write-offs design, which decides how money that is let go shows up.

#### Smaller, verified, and cheap — S each
- `Since` on `/tenants` renders `created_at` (`tenants/page.tsx:114`), so all 22
  rows read the same month; no room, no balance, and no portal-access column
  though `has_portal_login` is already in the response.
- Approve on a payment proof has no confirmation; Reject does.
- The Pending badge counts registrations only, so waiting money is invisible in
  the nav, and it is stale until reload.
- "72 characters or fewer" counts **bytes** — a 28-character Hindi passphrase is
  rejected with a message that is factually wrong, in an India-facing app.
- The settlement's whole-cycle billing is described as "Rent is billed up to this
  date"; moving the date nine days swung a settlement by ₹9,000. Adjustments
  never appear as a line, so the visible sum reads 18,000 − 22,000 = 5,500.
- A brand-new owner is greeted "Welcome back".
- ~~Payment type is "Online", not "UPI".~~ ✅ every screen says UPI (Oct 2026,
  `lib/payMethod.ts`; the stored value is still `online`). The nudge says "at your convenience" to
  someone 70 days late and carries no UPI handle.
- The registration-link panel promises "or a QR code pointing to it" and the app
  never makes one; the Copy button failed outright. *Copy is fixed. The QR code
  is deliberately later (Oct 2026): a printable "Scan to register" sticker,
  probably drawn by a small Go library so the frontend keeps its four
  dependencies.*
- **Later, owner's call (Oct 2026):** let the registration form ask "When are
  you moving in?" and "Paid anything yet?" (amount, Cash/UPI, screenshot), to
  fill in the approval. Both need a migration, because a payment needs a stay
  and a pending registration has none. Worth it only if people start
  registering before they arrive; today they register at the desk.
- 404s land on Next.js's raw black page; a missing tenant or site redirects
  silently with no message.
- `BASE_URL` does not follow `PORT`, so a local backend on a non-default port
  silently breaks every upload with no warning. (This cost the audit two false
  Blockers — see `docs/UX_REVIEW.md` → retractions.)
- ~~The pending queue's "Approve & collect deposit" option and its "Approve &
  record deposit" button still promise to record money.~~ ✅ Now "Approve &
  agree terms" and "Approve & save terms" (Sep 2026). Found while fixing B1.

### Feedback from running the real hostel, round two (Oct 2026)

Raised by the owner in the first days of real use, after the notebook import.
He asked for these to be taken **one at a time**, not batched.

#### ~~Nothing shows the money that actually came in~~ ✅ fixed on `insights-money` (Oct 2026)
Insights is now a table with a Rent / All money switch, and tapping a month
lists every line in it. The tenant tile says "Rent paid" with the deposit
underneath, and the dashboard tile adds "All money in". See
`docs/PROGRESS.md` → "Rent and all money". The original report:

Every "paid" and "collected" figure counts rent only, on purpose. Rent is
measured against rent billed, and a deposit counted there would read as over
100%. But the owner checks the month against his bank and cash together, so he
needs **all money in**: rent plus deposits received, minus deposits returned at
move-out. A month with no new tenants and two departures has *negative*
deposit flow, and that has to show. The tenant page's "Total paid" tile is the
sharpest case: a deposit recorded there does not move it, and the label does
not say why.

He also dislikes the Insights bar chart: he has to hover to read anything. He
wants a table you can read at a glance, with a way to switch between a rent
view and an all-money view. Design under discussion. Related: "Insights ignores
settlements" and "A payments list page" below.

#### ~~The Insights chart drifts left at 3 and 6 months on the iPad~~ ✅ gone with the chart
The bar chart was replaced by the month table (above), which is tested to fit
375px, 768px and 1024px without scrolling sideways. The original report: 12
months filled the panel; switching to 6 or 3 left the bars bunched to the left.

#### ~~A tenant row opens only from its "View →" link~~ ✅ fixed on `quick-ui-fixes` (Oct 2026)
The whole row on `/tenants` should open the tenant.

#### ~~Recording a payment is three screens deep~~ ✅ done on `payments-screen` (Oct 2026)
Tenants → tenant → Record payment, and this is the most frequent thing he
does. Collections became **Payments**: overdue, then due within 7 days, each
recorded in place with everything prefilled, plus "Who paid?" search for
anyone else. See `docs/PROGRESS.md` → "Payments". Left for later, at his
call: deposits still owed as rows, an undo, and new work on the moved-out
section (kept as it was, folded).

#### ~~"They're staying" does not cancel a vacating notice on the iPad~~ ✅ fixed on `move-out-flow` (Oct 2026)
Not the iPad: the button cleared only the leaving date, and a notice date on
its own still marks a bed as vacating, so the bed stayed orange. It now
cancels the notice outright, both dates, in one tap. Original report:

He recorded a notice, then tried to withdraw it with the "they're staying"
control, and nothing happened. Reproduce with touch emulation at 768×1024 and
1024×768 before guessing.

#### ~~The move-out flow is hard to follow~~ ✅ redesigned on `move-out-flow` (Oct 2026, migration 013)
One "Move out" sheet from the tenant page and the grid, in the owner's order:
the day, the deposit (by the notice rule), the money, the amount to hand back
(editable), and cash or UPI. See `docs/PROGRESS.md` → "Moving out". Original
report:

"End without settling", "Settle & vacate", adjustments, advance returned: the
owner, who built this with us, finds the words and the order unclear, and
expects someone who is not an engineer to find it more so. What he wants to do
at the door is simple: they gave notice on this date, they are leaving today,
take off any deductions, hand back the rest. Redesign the wording and the
steps around that sentence. Since the money work (Oct 2026), a settlement is
also what records a refund and dates it on the day they left, and an unsettled
leaver's deposit still counts as held, so the flow should make settling the
obvious path. One guard to add while there: settling with an end date earlier
than payments already recorded turns those payments into an "advance" that is
handed back, which is right only if they really were paid ahead. Say so
before confirming.

#### ~~When is each tenant's rent due?~~ ✅ first two parts done on `rent-due-dates` (Oct 2026)
The bed panel and tenant page have their one line, and grid tiles show a date
when someone is behind ("due 15 Oct", red) or due within 7 days (amber). The
owner trimmed the design before it was built: a red tile shows the date too,
not only the amount, and the line drops the repeated "every month on the
31st". **"Due this week" became part of the Payments screen** (Oct 2026), with
a one-line count on the dashboard instead of a second list. The original
proposal:

The owner wants to see at a glance when rent is due for a tenant. The app
already bills on each stay's anchor day (move-in day of the month; the 31st
clamps to a short month's last day, `cycleStart`), but no screen says so. The
proposal below is waiting on his pick of the first or first-plus-third option:

- **Bed drawer and tenant page:** one line under the balance:
  - "Next rent ₹6,000 due 31 Oct (every month on the 31st)" when square.
  - "₹6,000 overdue since 15 Oct" in red when behind: the oldest unpaid
    cycle's start, from `rentSchedule.paidThrough`, the same rule Collections
    uses for days overdue.
  - "Paid until 15 Dec" when ahead.
- **Grid tiles:** a small "due in 3d" only on tenants due within 7 days. The
  tiles are too small for a date on every one, and overdue tiles are already
  red.
- **Optional: "Due this week" on the dashboard,** next to Vacating Soon, with
  name, date and amount. It is the across-the-building view, and later the
  home for a one-tap Record payment (see "Recording a payment is three
  screens deep").

Backend: the grid and the tenant summary gain `next_due_date` and
`overdue_since`, computed with `cycleStart` and `paidThrough`, never
re-derived on the client. Ships with Go tests with exact dates (a 31st
move-in across a short month, a rent change mid-stay, paid ahead).

#### ~~Adding a tenant can't record what they paid up front~~ ✅ done (Oct 2026)
Reported 23 Oct 2026. New tenants usually pay the first rent, and often the
deposit, on the day they arrive, but the forms took only the terms. All three
forms that put someone in a bed now have "Paid today", and a booking (paid to
hold a place, bed on arrival) is its own choice on Add tenant. See
PROGRESS.md → "Paid today, and bookings".

#### ~~The tenant page's money tiles overflow on a narrow screen~~ ✅ fixed on `quick-ui-fixes` (Oct 2026)
Two across on a phone, Balance on its own row. `narrow-screens.test.ts`
measures the tenant page, dashboard, Payments, Insights and Tenants with
ten-lakh figures at 375, 768 and 1024; only the tenant tiles spilled. Original
report:

The three tiles (Rent paid, Stay duration, Balance) are three columns at every
width. With a six-figure amount ("₹1,19,000") in a phone-width window, the
figure runs out of its tile into the next. The fix is a smaller figure below
`sm`, or letting the row wrap. Seen by the owner in the browser pane (Oct
2026). Check the other tile rows (dashboard, Insights) at the same width
while there.

### Feedback from running the real hostel (Sep 2026) — ✅ all closed

Found by the owner using the live app against real tenants, not by building it.
These came **before** the sections below: they were small, and each one was
something that blocked or misled a real person on a real evening.

**All eight are now fixed** (Sep 2026 — see `docs/PROGRESS.md` → Phase 16a–16d).
The entries are kept rather than deleted, because what each one turned out to be
is the useful part: four of the last five were a capability the app already had
that no screen ever offered. Only one thing raised here is still open, noted
inside its entry: sending the registration link to a tenant the owner added by
hand, so they set their own password rather than being told one.

**A standing rule that came out of this round:** *anything a tenant can do in
the portal, an owner must be able to do from the owner side.* No capability is
allowed to be portal-exclusive. The reason is not symmetry for its own sake —
an owner-created tenant has **no portal account at all** (see below), so a
portal-exclusive capability is not merely inconvenient for them, it is
unreachable forever.

#### ~~An owner cannot record a vacating notice~~ ✅ fixed
The first thing the owner tried to do and could not. `stays.notice_date` is
*read* in three owner-side places — the "Notice …" badge on the tenant page
(`tenants/[id]/page.tsx:532`), the dashboard Vacating list, and orange
"vacating soon" in the grid — and *written* in exactly one place in the whole
app: `PUT /api/portal/stays/:stayId/notice`, the tenant portal
(`tenant_portal.go:140`). So the dashboard's Vacating list
(`dashboard.go:283`, `AND s.notice_date IS NOT NULL`) can only ever be filled
by a tenant logging in — and an owner-created tenant cannot log in.

**Fixed.** `RecordNoticeDialog` sits next to "Settle & vacate" on the tenant
page and in the grid's occupied-bed drawer — one component for both, the same
way `EndStayDialog` is, because those two surfaces had already drifted once.
The portal learned the date too, so a tenant can now say *when*.

It needed a schema change after all, though — see the entry below.

#### ~~Deleting a room or bed silently destroys stays and payments~~ ✅ fixed
No occupancy guard anywhere. `DeleteBed` is a bare `DELETE FROM beds`
(`rooms.go:282`); `DeleteRoom` the same one level up (`rooms.go:139`). The FK
chain is `beds → stays → payments`, every link `ON DELETE CASCADE`
(`001_init.up.sql:72`, `:93`). So deleting a bed someone currently occupies
destroys their stay **and their entire payment ledger**, unrecoverably, behind
a confirm that says only "Delete this bed?" and then toasts "Bed removed".
Deleting a room does it to every bed in the room at once.

On a live account with real rent history that is one misclick.

**Fixed as specified:** `ledgerFootprint` counts what the cascade would take
and both handlers return 409 when any stay references the bed — ended or not.
The cascade itself is untouched. The refusal names counts only, never a tenant,
and the frontend surfaces the server's own words instead of the generic
"Failed to delete" it used to swallow them into.

Found while testing it: the bed's remove button had `title="Remove bed"` but
text content `×`, and text wins the accessible name — so it announced itself as
"times". Now carries an `aria-label` naming the bed.

**Follow-up, Sep 2026 — the dialog was lying.** The confirm said a bed with
history "cannot be deleted" and then offered a red Delete button, because the
footprint was computed inside `DeleteBed` and the page had no way to know which
case it was in. The list endpoints now return `stay_count`/`payment_count` per
row, so the page explains rather than offering. See `docs/PROGRESS.md` → 16e.

#### ~~There is no way to rename a room or a bed~~ ✅ fixed
Backend `PUT /api/sites/:siteId/rooms/:id` and
`PUT /api/sites/:siteId/rooms/:roomId/beds/:id` both existed and worked, and
`roomsApi.update` / `bedsApi.update` both existed in `lib/api.ts`, with not one
call site between them. Built, wired, never surfaced.

**Fixed.** A pencil on the room header (name + floor) and on each bed chip,
both editing in place beside the delete that was already there.

Found while doing it: the chip's buttons were `hidden ... group-hover:inline`.
`display: none` also removes an element from the tab order, so the `×` had been
unreachable by keyboard since it was written — and on a phone, which has no
hover at all, neither button ever appeared. They fade from `sm` up now and stay
visible below it.

#### ~~A stay can only be created from the grid~~ ✅ fixed
`/tenants/new` created a *person* — name, phone, Aadhaar, photos — and nothing
about where they would sleep. The only `staysApi.create` call site in the whole
frontend was `sites/[id]/grid/page.tsx`, so adding a tenant meant filling the
tenant form and then navigating Sites → site → room → bed → assign.

**Fixed with the extraction this entry asked for, and it was overdue.** There
were already four copies of these fields: the grid drawer, the
pending-approval drawer, the tenant page's assign modal, and nothing at all on
the new-tenant form. They had drifted — only the pending drawer's rent label
followed the billing cycle, so the grid asked for "Monthly rent (₹)" while
collecting a daily one. `components/StayForm.tsx` now holds `StayTermsFields`
and `BedPicker`; the three existing call sites use them and the new-tenant form
is the fourth.

An optional "Place them in a bed now" section, off by default because an owner
often adds someone days before a bed frees up. Terms are validated **before**
the tenant is created — a rent typo must not cost a half-made record — and a
stay that fails after the tenant exists says exactly that rather than
discarding the submission.

Not converted: the pending drawer's bed selector is a two-stage `Select` with a
deliberate "Select a site…" placeholder, inside a mode-selection flow.
`BedPicker` preselects the first site, which is right for the other two callers
and wrong for that one. Left alone on purpose.

#### ~~The known end date has nowhere to go~~ ✅ fixed — migration 006
The owner knew the tenant's departure date at the moment of adding them, and
there was no field for it anywhere: not on the tenant form, not on the grid's
assign form (rent / deposit / cycle / start date only), and `EndStayDialog`
caps its date picker at `max={today()}`.

That cap is not arbitrary. In this codebase `end_date` means *"this stay is
over"*, not *"they leave on this date"* — `active = !stay.end_date` everywhere,
and the grid joins `s.end_date IS NULL` (`grid.go:118`). Setting a future
`end_date` would free the bed while the person is still in it.

The fossil of the intended design is still in the tree:
`computeBedStatus` has an `endDate` within-30-days → `StatusVacatingSoon`
branch (`grid.go:226`) that **can never fire in production**, because the grid
only ever loads stays where `end_date IS NULL`, so `endDate` is always nil by
the time it arrives. It has a passing unit test and is unreachable.

**Resolved differently from the guess here.** `notice_date` turned out to be the
wrong field for a known departure: the portal stamps it with `time.Now()`, so
reusing it would have made every tenant tapping "I'm leaving" say "I leave
today". They are three separate facts and now have three columns —
`notice_date` (they told you), `expected_end_date` (they say they're going),
`end_date` (they went).

The dead branch was **resurrected, not deleted**, pointing at
`expected_end_date`. Its test used to assert that a past date read as
`vacating_soon`; a past expected departure now means `departure_due`, a sixth
bed status that outranks arrears — "did they actually go?" is worth asking
before the balance is worth reading.

Nothing acts on the date automatically. People overstay and leave early, so a
passed date raises a question on the dashboard rather than ending a stay, and
"They're staying" clears it without inventing a departure that never happened.

#### ~~Tenants added by the owner have no portal account~~ ✅ fixed
`TenantAuthHandler.Login` required `password_hash IS NOT NULL`, and the password
was collected only by the public registration form — owner-side
`TenantHandler.Create` never inserted one. So every tenant an owner added by
hand was permanently locked out of `/my`, which is how the vacating-notice gap
became total rather than merely annoying.

**Fixed the first of the two ways listed here:** the owner can set or reset a
portal password from the tenant page. `PUT /api/tenants/:id/portal-password`,
owner-scoped, sharing `validatePassword(pw, 6)` with public registration so the
two paths cannot drift the way the bcrypt-72 bug did.

A *set*, not a change — the owner does not know the old password and should not.
The dialog offers "Show password" because the owner has to read it out loud, and
says plainly that it cannot be read back.

The tenant page now shows which state a tenant is in, from a computed
`has_portal_login` (`password_hash IS NOT NULL AND password_hash <> ''`) added
to `tenantCols`. The hash itself stays `json:"-"`; what leaves the process is
the one bit the owner needs. The login query moved to `password_hash <> ''` at
the same time so there is one spelling of that predicate rather than two.

Still not done, and still worth doing: **sending the registration link to a
tenant who was added manually**, so they can set their own password rather than
being told one.

#### ~~The registration form has no photo upload~~ ✅ fixed
`/register/[ownerId]` uploaded ID front and back and its payload carried no
`photo_url` at all — even though `tenants` has the column and the owner-side
form has the field.

**Fixed.** `IdProofField` became `UploadField` with an `accept` prop, and the
photo field uses it with images only. `publicRegisterRequest` gained
`photo_url`, validated by `ValidateUploadedURL` like the other three.

The file-picker flow was not regressed: still no `capture` attribute on any of
the three fields, because forcing the camera would break picking an existing
photo out of the gallery — which is the part of this page that was singled out
as already working well on a phone.

#### ~~Resolved on inspection~~ ✅ the wording is fixed too
- **"What email does the tenant log in with, if email is optional?"** They do
  not. Portal login is **phone + password** (`tenant_auth.go:46`); email never
  participates in auth and is stored for contact only. Nothing was wrong in the
  code — but the registration form invited the question and never answered it,
  which is its own kind of bug.

  The Email field now reads "For contact only — you sign in with your phone
  number", the password hint names the number they just typed, and `/my/login`
  says "Sign in with your phone number — not your email" under the heading. Its
  password field also points somewhere when there is no password: ask the owner
  — which is now an answer, because the owner can set one.

### UX polish

#### ~~"Vacating soon" on the dashboard is not clickable~~ ✅ fixed in Phase 15d
Both lists now carry `tenant_id` (and the vacating list a `stay_id` to key on)
and every row is a link. The catch recorded here was right: it needed the SQL,
both row structs, both public structs and the TS interfaces, not a `<Link>`
around existing data.

#### ~~Collections rows only link to a tenant when the phone is broken~~ ✅ already fixed
`collections/page.tsx:118` links every tenant name; the "Fix phone" link is now
only the fallback it was meant to be. Closed on discovery during Phase 15d.

---

### Observability

Full picture in `docs/DEPLOYMENT.md` → "Where the logs go".

#### ~~50 handlers return a 500 and discard the error~~ ✅ done
`serverError(c, err, msg)` logs method, route, message and cause behind all of
them. One chokepoint, so error tracking wires in once rather than seventy times.

#### ~~19 `db.Get` / `db.Select` calls drop their error entirely~~ ✅ done
They were ownership checks: a failed query left `count` at 0, so the handler
answered "not found" and a database problem looked like a missing record.

#### ~~The frontend has no `global-error.tsx`~~ ✅ done
`error.tsx` and `global-error.tsx`, both reporting through `lib/reportError.ts`.

#### ~~No error tracking or alerting~~ ✅ done (Sep 2026)
Sentry, EU region, wired into the two existing chokepoints plus panics and boot
failures. Scrubbing is verified against a captured wire payload, not assumed —
see `docs/DEPLOYMENT.md` → "Verified, not assumed". Alert rules and the one
thing the scrubber deliberately does not cover (names) are documented there too.
Still needs a human to create the account and paste the two DSNs.

### Security / privacy

#### ~~Tenant ID scans live at permanent public URLs~~ ✅ fixed (Sep 2026) — migration 010

**Done in PR #38** (`pre-import-hardening`), which the owner approved on 23 Sep 2026, before the
import. The database stores object keys (`public/<32 hex>.jpg`), and every
response that carries a file mints a presigned link valid for an hour
(`handlers/files.go`, `storage.SignedURL`). Migration 010 rewrote the stored
URLs. The code also reads old URLs, so the order of deploy and migration does
not matter. **Verified in production on 23 Sep 2026:** migration 010 was run
on Neon, the R2 Public Development URL was disabled, and `storage-check
--public-url` reported the signed link opening and the plain link refused
(401). See `docs/DEPLOYMENT.md` → "Private uploads". The original write-up:


**Found cold by the Sep 2026 UX audit**, by a tester who then read the form's own
promise — "stored securely and only visible to the property owner" — and called
it untrue. They added a detail worth carrying: the pending-queue API ships
`aadhaar_number` in full plaintext to the browser while the UI masks it to
`XXXX-XXXX-7777`, so the masking protects nothing and the owner still cannot
verify the number against the card.
The R2 bucket is publicly readable (decided at deploy, Aug 2026). Object keys are
`public/<32 hex>.jpg` from `crypto/rand`, so they are unguessable and the r2.dev
subdomain does not list directories — the model is a Google Docs "anyone with the
link" share. But the links never expire, and they leak by being *seen*: Render's
request log, the owner's browser history and cache, any link-preview fetcher, and
an error tracker if one is ever wired in.

The fix is presigned GET URLs minted per read. **The reason this is M and not S:**
`id_proof_url`, `id_proof_front_url`, `id_proof_back_url` and `photo_url` store
absolute URLs, so it is a new `storage.Service` method, a change to every read
path that returns one of those fields, *and* a data migration turning stored URLs
into stored keys. Every real tenant row added makes the migration bigger, so the
cost only goes up.

Related: a custom domain on the bucket is wanted regardless — Cloudflare treats
`pub-*.r2.dev` as a development subdomain and rate-limits it.

#### The app collects full Aadhaar numbers and card images — decided: keep the number (23 Sep 2026)

> **Reversed, 23 Sep 2026: keep storing the number as typed.** Asked again, the
> owner said they did not much care either way. What settled it: the front of an
> Aadhaar card shows all twelve digits, so cutting the typed number to four
> protects almost nothing while the image exists. The exposure worth fixing was
> the images, and those are now private (migration 010). The number stays
> optional on both forms; registration now **requires** the front of an ID, and
> the owner-side form does not. Point 1 below (the "stored securely" wording) is
> still worth a sentence.
>
> **Earlier decision (18 Sep 2026, superseded): store the last four digits only.** The owner does not
> need the full number — the ID images already identify the person. That answers
> question 3 below. **Not built yet.** It needs: the registration and
> new-tenant forms to take (or keep) only four digits, the pending queue to stop
> shipping the full number to the browser, and a migration truncating existing
> values to their last four. Cheapest done *before* the real import, so no full
> numbers ever land in production. The image-storage question above is
> separate and parked.

Registration asks for a 12-digit Aadhaar number (`page.tsx:312`, optional) plus
front and back ID images. The number is stored as `aadhaar_number VARCHAR(20)`
in plaintext — `grep` finds no encryption anywhere in the backend — and the
images sit at permanent public URLs (see the item above).

Three separate things tangled together, worth pulling apart before any of them
is "fixed":

**1. The form makes a promise the storage does not keep.** The hint reads "Your
Aadhaar number is stored securely and only visible to the property owner." It is
not untrue — TLS in transit, Neon encrypts at rest, queries are owner-scoped —
but "stored securely" reads as something stronger than a plaintext column, and
it is shown at the exact moment someone decides whether to type the number.
Either soften the wording or make it accurate. The cheap honest version costs
nothing; the wording change is S on its own.

**2. UIDAI guidance discourages storing Aadhaar copies at all**, and points to
masked Aadhaar (last four digits) where identity confirmation is the actual
need. India's DPDP Act adds its own obligations for personal data at rest. This
is not legal advice and nobody here is a lawyer — the point is that it is a real
question for an app whose registration form asks for this, and it should be
answered deliberately rather than by default.

**3. Does the app need the full number?** Nothing computes on it — it is stored
and displayed, never validated, never matched. If the purpose is "the owner can
confirm who this person is", the ID images already do that and the last four
digits are enough to cross-check. Dropping to masked storage would remove most
of the exposure without removing the feature.

Cheapest first step is (1). Do not touch the column without deciding (3), or the
migration gets done twice.

#### ~~`ValidateUploadedURL` checks the extension, not the host~~ ✅ fixed with private uploads (Sep 2026)
Gone. File references must now be a key the upload handler could have issued
(`storage.ValidKey`), and a URL of any host is refused, as predicted below. The
owner's create-tenant path, which had no check at all, has one now. Reads also
drop any stored value that is not one of our keys, rather than handing it to a
browser. The original write-up:

It exists to sanity-check client-supplied URLs before they are stored, and it
only tests `filepath.Ext(url)` against the allowed types. So a registration or a
tenant update can store `https://anywhere.example/x.jpg` and the owner's browser
will fetch it when the profile renders — a small SSRF-by-browser and a tracking
pixel aimed at one person.

Pre-existing across `id_proof_url`, `id_proof_front_url` and `id_proof_back_url`;
noticed while adding `photo_url` as a fourth (Phase 16d), which follows the same
weak rule rather than inventing a stricter one for itself.

**Why it is not a one-liner:** the allowed prefix is the storage service's public
base, which differs between the local disk backend and R2, and is not visible
from `handlers` — `ValidateUploadedURL` is a package-level function with eight
call sites and no access to `storage.Service`. It also wants deciding alongside
the presigned-URL item above, which turns all four columns into keys and makes
the check trivial. Do that first, or do this one knowing it will be redone.

---

### Found by Sentry (Sep 2026, first hour)

Both of these were live in production and invisible before error tracking.
Neither was found by a test or by reading code — they arrived as issues from
one signup.

#### ~~`/api/collections` intermittently 500s — prepared statements crossing connections~~ ✅ fixed (Sep 2026)
**Closed 23 Sep 2026.** The owner confirmed that `DATABASE_URL` on Render points
at the direct endpoint and that the issue is fixed. If `HOSTEL-BACKEND-1/2/3`
ever recur, the boot-log warning from `database.IsPooledEndpoint` is the first
thing to check. The original write-up:

`HOSTEL-BACKEND-1/2/3`. Three issues, almost certainly **one bug**:

```
pq: unnamed prepared statement does not exist (26000)
pq: bind message has 4 result formats but query has 17 columns
pq: bind message has 17 result formats but query has 4 columns
```

The third is the second one backwards, and that symmetry is the whole
diagnosis: **two different queries had their protocol state swapped on the same
server connection.** One statement was bound with another statement's
parameters, in both directions, at the same moment. That is not something
application code can do to itself.

Evidence it is not ours: `grep` finds no `go func`, `WaitGroup` or `errgroup`
anywhere in `internal/handlers`, and `GetCollections` runs exactly one
`db.Select`. The queries were concurrent because the home page fires several
fetches in parallel after login — not because a handler forked.

**Hypothesis confirmed (Sep 2026).** The Neon hostname does contain `-pooler`,
and the `route` tags on the three issues were *different* endpoints —
`/api/collections`, `/api/tenants` and others. That second fact is what settles
it: this was never a collections bug. Whatever two requests happened to be in
flight at the same moment were the ones that broke.

**Done by the owner (18 Sep 2026):** `DATABASE_URL` on Render now points at the
direct endpoint, without `-pooler`. Not yet verified from this side — confirm
the next Render boot log no longer prints the pooled-endpoint warning, and that
`HOSTEL-BACKEND-1/2/3` stop recurring in Sentry, before calling this closed.

**Remaining work was one env var**, and it is not something Claude can do — the
connection string is a secret held in Render. `database.IsPooledEndpoint` now
warns loudly at boot while it is still wrong, so this cannot go quiet again.

**Original hypothesis, kept because it was right:** `DATABASE_URL` points at Neon's *pooled*
endpoint (hostname containing `-pooler`), which is PgBouncer in transaction
mode. `lib/pq` uses the extended query protocol with unnamed prepared
statements, and those are per-session; transaction pooling can hand the Bind to
a different server connection than the Parse. `26000` is the canonical symptom.

**Check before fixing** — look at the Neon dashboard or Render's env tab for
whether the host contains `-pooler`. Do not paste the connection string
anywhere; the hostname alone answers it.

Two fixes if confirmed, in order of cost:
1. Point `DATABASE_URL` at Neon's **direct** endpoint (no `-pooler`). One
   env-var change. `SetMaxOpenConns(25)` from a single Render instance is well
   inside what the direct endpoint allows, so the pooler is not buying us
   anything at this scale.
2. Switch the driver to `pgx/v5` with `default_query_exec_mode=simple_protocol`,
   which is pooler-safe. Bigger change — `lib/pq` is imported in
   `internal/database` and the `pq.Error` type is not referenced elsewhere, so
   it is contained, but it is still a driver swap on a live app.

Start with 1. If it holds, 2 is not needed.

**Why this matters beyond collections:** nothing about the failure is specific
to that query. Any two concurrent requests can hit it, which means the dashboard
and grid are exposed to the same thing and simply have not been caught yet.

#### ~~Passwords over 72 bytes return 500 instead of 400~~ ✅ done (Sep 2026)
`HOSTEL-BACKEND-4`, `bcrypt: password length exceeds 72 bytes`. Found while
looking for a way to trigger a real error safely, which it turned out to be.

`Signup` checks `len(req.Password) < 8` but has no upper bound, and
`bcrypt.GenerateFromPassword` returns `ErrPasswordTooLong` above 72 bytes. The
error reaches `serverError`, so the user gets an opaque "failed to process
password" 500 for what is really a validation failure — and now it pages us too.

`PublicRegister` in `tenants.go` has the same shape (`len(req.Password) < 6`, no
maximum) and is worse: it is on the public QR path, hit by a stranger with no
account and no way to tell you it broke.

Fixed. Both handlers now share `validatePassword(password, min)` — they had
drifted apart, which is how the same bug came to exist on two paths and be
noticed on one. `HashPassword` also maps bcrypt's error to
`auth.ErrPasswordTooLong`, so a future call site that forgets to validate still
gets something classifiable rather than an opaque 500.

The byte-vs-character trap is covered by a test using 25 Devanagari characters:
under the limit by any rune count, over it by the only measure bcrypt uses.

### Correctness / consistency

#### ~~Collections and the dashboard disagree about bed-less stays~~ ✅ fixed (Sep 2026)
The dashboard's filter was dropped, as guessed below, in its own change with a
test asserting the tile equals Collections to the paisa.


**Rediscovered independently by two testers in the Sep 2026 UX audit**, on a link
whose own subtitle reads "chase it from Collections →". Measured: ₹40,400 vs
₹47,900, the gap being exactly one bed-less tenant.
`GET /api/collections` includes stays with no bed assigned; the dashboard's
`overdue_amount` excludes them (`s.bed_id IS NOT NULL`). An owner who has taken
a deposit without allocating a room sees two different totals for the same
money. Probably fixed by dropping the dashboard's filter, but that changes a
tested figure, so it wants its own change rather than riding along with
something else. Flagged during Phase 10.

#### ~~No rate limiting on the remaining public endpoints~~ ✅ done (Sep 2026)
**Done in PR #38** (`middleware/login_limit.go`):
- **Owner login and tenant login** get ten *failed* attempts per client IP, then
  one more a minute. Only a 401 costs a token, so a hostel's worth of correct
  logins from one Wi-Fi never trips it. The two logins have separate budgets.
- **Public registration** allows twenty per IP *per hostel*, then one every
  three minutes. That covers move-in day on shared Wi-Fi. Keying on the owner
  also keeps the e2e suite, which makes a fresh owner per test, from throttling
  itself.

Still open, and smaller: a second budget keyed on the phone or email, against
guessing spread across many IPs. `/auth/signup` is still unthrottled. There is
also still no password complexity rule. The original write-up:


**Confirmed cold by the Sep 2026 UX audit**: 15 consecutive wrong passwords, 15
clean 401s, no delay or lockout. Compounded by there being no password
complexity rule at all — a ten-space password created a working owner account.
`/auth/login`, `/tenant-auth/login` and `/public/register/:ownerId` are still
unthrottled. Low risk while the registration link is on a fridge; a real one the
day it is printed on a QR code by the door. Tracked in PROGRESS.md under
Deferred as well, because it is also a go-live consideration.

`/public/upload` is **done** — `middleware.PublicUploadRateLimiter()` caps it
per client IP (deploy session, Aug 2026). The pattern is there to copy; the
logins want different numbers (credential stuffing, not bulk storage) and
`/public/register` writes rows, so neither is a straight reuse of the upload
budget.

#### ~~`frontend/.env.example` does not exist~~ ✅ done
Added before the deploy. One variable, `NEXT_PUBLIC_API_URL`, with a note that
missing it on Vercel produces a clean build whose every request then fails
against localhost in the browser.
