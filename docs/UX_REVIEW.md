# UX review — seven fresh-eyes sessions on the live app

**Run:** 9 Sep 2026, against `98520c3` (Phase 16, #33) on a seeded local stack.
**Method:** session-based exploratory testing, structured as cognitive walkthroughs,
with a heuristic-evaluation pass layered on top. Seven testers, none of whom read
the source or `docs/BACKLOG.md`.

Every previous round of feedback came from the person who built the app or the
owner running it. This is the first round from people meeting it cold. The
distinction matters because of what Phase 16 already taught us: seven of its
eight items were capabilities the code *had* and no screen *offered*. A test
that asserts a flow works cannot find that class of problem. A stranger can.

---

## How to read this

Findings are ranked by **severity × hit count**. Hit count is how many of the
seven testers found the same thing *independently* — they could not see each
other's reports, so three hits is evidence, not repetition.

Tags: **NEW** · **CONFIRMS** an open `BACKLOG.md` item (independent rediscovery,
which is a ranking signal) · **RETRACTED** (reported but false).

---

## Two retractions, first

Honesty about what did not survive verification:

1. **"Every uploaded image is broken — wrong port"** (C4, C5 — both filed it as a
   Blocker). **False, and my fault.** `BASE_URL` defaults to
   `http://localhost:8080` (`storage/selector.go:32`) and I ran the audit backend
   on `:8081` without setting it. An artifact of the test rig, not the product.
   The residue worth keeping is a one-line devex note: `BASE_URL` does not follow
   `PORT`, and a local run on a non-default port silently breaks every upload.

2. **"There is no way to record a payment from the tenant page"** (C1, C3, C5, C7
   — four testers, filed as GAP). **The capability exists** —
   `tenants/[id]/page.tsx:694` renders `+ Add payment`, with the full ledger.
   It is behind an expander with no chevron, no ring and no affordance except
   `cursor-pointer`, which does not exist on a touchscreen. So the finding is
   real and severe; it is a **UX discoverability** failure, not a missing
   feature. Four independent testers concluding a shipped feature does not exist
   is a stronger result than a genuine gap would have been.

Both are exactly the failure mode `BACKLOG.md` already records four times over —
which is why the plan required grepping for a call site before writing "there is
no way to X".

---

## Themes — the design-level findings

The individual findings are evidence; these six are the actual feedback.

### 1. There are two tiers of this app, and the phone gets the lesser one

The product's own premise is a one-handed owner in a corridor. That user gets a
measurably smaller app, and is never told which parts are missing:

- Three destructive controls are `hidden … group-hover:*` — invisible and
  unreachable on touch, and unreachable by keyboard on desktop.
- Insights charts are drawn past the right edge and cannot be scrolled to.
- Chart values are hover-only, and the caption *says* "Hover a month".
- Almost nothing reaches a 44px touch target; the settlement actions are 16px
  text links 12px apart.

C2 put it exactly: correcting a money mistake is *not hard on a phone, it is
impossible*. Phase 16 fixed this pattern in `sites/[id]/page.tsx` — the correct
`sm:opacity-0 sm:group-hover:opacity-100` + `focus-visible:opacity-100` recipe is
already in the codebase. It was applied to one file of four.

### 2. The page named after the person is the worst view of them

Five of seven testers, arriving by five different routes, independently
concluded the tenant profile was broken or incomplete. It shows `Bed #31`
instead of `Room 202 · 1L`; it shows `Paid —` for a tenant who has paid
₹1,27,500; the deposit appears nowhere; and its ledger is behind an invisible
expander. The grid's bed drawer — same tenant, same data — has all of it, laid
out well. Two views of one tenant, and the one reached from the Tenants menu is
strictly the weaker.

### 3. The per-tenant money is right; every roll-up disagrees with every other

C7 checked the arithmetic three ways and Insights reconciles exactly
(₹7,86,300 by month = by room = header). Individual balances are correct. But
the summaries each roll up differently, and **no dashboard tile says how it was
computed**:

| Quantity | Dashboard | Collections / Insights | Gap | Cause |
|---|---|---|---|---|
| Owed now | ₹40,400 | ₹47,900 | ₹7,500 | one bed-less tenant |
| Collected this month | ₹69,900 | ₹53,600 | ₹16,300 | two future-dated payments |
| Occupancy "now" | 65% | 61% | — | beds-today vs bed-nights |

The engine is sound. The trust damage is entirely in the presentation layer.

### 4. The explanatory copy is excellent — and it is all locked inside dialogs

The `RecordNoticeDialog`, the delete guard, and the Insights footnotes were
named unprompted as best-in-product by four separate testers. C3: *"it taught me
a three-way distinction I'd never articulated in twenty years of a notebook, in
one screen, without jargon."*

Then the dashboard renders the same three dates as an unlabelled chip — `Notice:
2026-08-31` next to `Leaving 2026-09-30` — and three testers read the first as
"he already left". The habit of a sentence saying how a figure was derived
exists and works; it just never reaches the screens people actually scan.

### 5. Entry is easy everywhere; correction is absent everywhere

Every tester hit this from a different direction. You cannot: edit a payment,
undo a settlement, un-approve a proof, withdraw a notice as a tenant, correct a
rejected submission, recover an owner password, or change an owner password.
The one exception — the owner's "Reset portal password" dialog — is genuinely
excellent, and is the template the rest of the app needs.

The safety is also inverted: **rejecting a registration, which the applicant can
simply resubmit, asks for confirmation. Settling a deposit, which is irreversible
and moves the largest sum in the business, does not.**

### 6. The half a stranger sees did not get the care the owner half got

Public error strings are raw lowercase server text (`invalid phone or password`,
`registration link not found`) against the owner side's `Enter the rent amount.`
Phone and Aadhaar accept any characters. A duplicate registration is silently
accepted. There is no privacy notice on a form that collects a national ID and a
face photo — and the one promise it makes about Aadhaar is not kept.

---

## Findings

### Blockers

**B1 · Settling a stay refunds a deposit the tenant may never have paid** — NEW, verified
`settlements.go:226,232,318` pass `stay.DepositAmount` — the deposit agreed as a
*rent term* at intake — into `refundFor()` as money held. C3 created a tenant,
paid nothing, and the drawer offered to refund him ₹8,000. Irreversible, no
confirmation step, and the tenant profile never shows a deposit to cross-check
against. **Fix:** compute held deposit from recorded deposit payments; show
"₹16,000 agreed · ₹0 received" when they differ. **M**

**B2 · Correcting a payment is impossible on a phone** — 3 hits, CONFIRMS the
hover-only pattern Phase 16 half-fixed
Payment-row delete is `hidden … group-hover:block` in both
`tenants/[id]/page.tsx:772` and `sites/[id]/grid/page.tsx:684`; site delete the
same at `sites/page.tsx:149`. `display:none` on a device reporting
`(hover:none)`, and keyboard-unreachable everywhere. There is no edit at all, so
delete-and-re-add is the only correction path. **Fix:** apply the
`sm:opacity-0 … focus-visible:opacity-100` recipe already used in
`sites/[id]/page.tsx`. **S**

**B3 · No owner can change or recover their password, or revoke a session** — NEW (+ CONFIRMS the DEPLOYMENT.md runbook's premise)
No `/forgot`, `/reset-password`, `/settings`, `/account` route exists; `GET /api/me`
is read-only. Sign-out is local-only — C6 captured a token, signed out, and
`/api/me` still returned 200. Tokens last 24h, so the password is typed daily.
Recovery today is a `psql` runbook. **Fix:** email reset + an account screen with
change-password; invalidate tokens on change. **M**

### Major

**M1 · The tenant ledger is behind an expander with no affordance** — 5 hits, NEW
See retraction 2. `cursor-pointer` on a plain `<div>` — not focusable, not
announced, invisible on touch. Testers concluded their payment had not saved and
one re-recorded it. **Fix:** a real `<button>` with a chevron and a payment
count, expanded by default for a single stay. **S**

**M2 · Insights charts are drawn off-screen and cannot be reached** — 3 hits, NEW, mechanism verified
Measured at 375px: chart 672px wide, right edge 704px, `document.scrollWidth`
pinned at 375. **`ChartScroll` is correctly written** (`-mx-1 overflow-x-auto`)
— the failure is above it: the grid item never shrinks (default
`min-width:auto`), so the card expands to 704px and the scroller is 680 wide
with 680 of content, i.e. nothing to scroll. `<main>`'s `overflow-x-hidden` then
clips the lot. The recent months — the whole story in the data — are the part
cut off. **Fix:** `min-w-0` on the grid item; the same recipe is already twice in
this layout's ancestor chain. **S**

> **The e2e test cannot catch this.** `insights.test.ts` asserts only that
> `documentElement.scrollWidth - clientWidth <= 1`, which `overflow-x-hidden`
> guarantees *by clipping* — the test passes for the same reason the bug exists.
> It also runs against a fresh owner with no data, so it never renders a chart.
> Worth fixing the test in the same change.

**M3 · "Collected This Month" counts payments dated in the future** — 3 hits, NEW
`dashboard.go:218-219` bounds the month but never caps at today; Insights does.
C7 proved it exactly: ₹69,900 − ₹7,800 (dated 17 Sep) − ₹8,500 (dated 13 Sep) =
₹53,600, Insights' figure, on 9 Sep. **Fix:** cap the window at today and reject
or badge future payment dates. **S**

**M4 · Dashboard "Overdue" and Collections disagree by one bed-less tenant** — 2 hits, **CONFIRMS** `BACKLOG.md` → "Collections and the dashboard disagree about bed-less stays — S"
₹40,400 vs ₹47,900. The tile sums bed grids; a tenant with no bed is in no grid.
Independent rediscovery by two testers, on a link that says "chase it from
Collections". **S**

**M5 · The grid's "Overdue" filter hides the largest debt in the business** — NEW
HSR reads `Overdue 0` while a tenant there owes ₹17,000, 70 days late — she is
filed under `Vacating 1`. This is the documented precedence working as designed
(`grid.go:31-35`), but the *filter* inherits it, so across both sites the
Overdue chips cover ₹19,500 of ₹47,900. A vacating tenant in deep arrears is the
most urgent person in the building. **Fix:** an "owes money" filter that ignores
lifecycle status, or non-exclusive chips. **M**

**M6 · A rejected payment proof is deleted, and the tenant is never told** — NEW
"Reject and delete this payment submission?" means it. The row vanishes from the
tenant's history with no status, no reason, no record they ever submitted it —
and nothing is sent to them. **Fix:** soft-reject with a "Not accepted" status
and an optional reason. **M**

**M7 · Beds are named by database id on the tenant profile** — 5 hits, NEW
`Bed #31`. Every other surface — grid, Collections, Recent Payments, the bed
picker one screen earlier, and the tenant's own portal — renders `Room 202 · 1L`
correctly. **S**

**M8 · Owner sign-out leaves the tenant session intact** — NEW
`auth.tsx:61` removes only `hostel_token`; `hostel_tenant_token` survives. C6
signed the owner out, opened `/my`, and landed in a tenant's ledger. Front-desk
machines are shared. **Fix:** clear both keys on either sign-out. **S**

**M9 · "Paid —" is a loading placeholder that never finishes loading** — 2 hits, NEW (and a corrected reading)
Header reads `TOTAL PAID ₹1,27,500`; the stay row six inches below reads
`Paid —`. My first reading was "wrong data". It is not: `PROGRESS.md` records
that Phase 11 deliberately chose `Paid —` over a false `₹0` because the ledger is
lazy-loaded on expand. The dash means *not fetched yet* — a good decision.
It fails only because of M1: the expander that would fetch it is invisible, so
the placeholder becomes the permanent state, and an em-dash in a numeric slot
reads as zero. **Fixing M1 fixes this**; it needs no separate change beyond
confirming the dash never outlives a completed fetch. **S**

**M10 · Session expiry mid-form shows "invalid token" and strands you** — NEW
No redirect, no re-auth, no retry; the only escape is a reload, which discards a
part-typed tenant profile. Being bounced to `/login` also never says why and
never returns you (`?next=` absent). **M**

**M11 · An empty state claims "No sites yet" while sites are still loading** — NEW
Three seconds of a confident, actionable, wrong instruction on `/tenants/new`,
shown to an owner with two sites. **Fix:** render loading before empty. **S**

**M12 · Settling a tenant erases what they still owe from Collections** — NEW
A settlement leaving the tenant ₹5,500 in debt removes them from the chase list
and the dashboard total. The tenant most likely to skip is the one the app stops
reminding you about. **Fix:** keep settled stays with a balance under a "Moved
out — still owes" group. **M**

**M13 · No rate limiting on either login endpoint** — **CONFIRMS** `BACKLOG.md` → "No rate limiting on the remaining public endpoints — M"
15 consecutive wrong passwords, 15 clean 401s, no delay. Compounded by no
complexity rule at all — a ten-space password created a working account. **M**

**M14 · Aadhaar scans are served to anyone with the URL** — **CONFIRMS** `BACKLOG.md` → "Tenant ID scans live at permanent public URLs — M"
Found cold by a tester who then read the form's promise — *"stored securely and
only visible to the property owner"* — and correctly called it untrue. Note the
compounding detail they added: the pending-queue API ships
`aadhaar_number` in **full plaintext** to the browser on every load, while the
UI masks it to `XXXX-XXXX-7777`, so the masking protects nothing and the owner
gets no way to verify the number either. **M**

**M15 · Validation errors render at the top of the form while focus jumps to the bottom** — NEW
On `/register/[ownerId]` at 375px the message sits ~1,300px above the field the
browser scrolls to. The user sees a highlighted field and no reason. **S**

### Minor and Polish

Grouped, with hit counts where >1:

- **Touch targets** (5 hits) — almost nothing reaches 44px: Nudge 32px, form
  inputs 38px, room rename/delete 24px with **0px** between them, portal Sign
  out 20px, modal buttons 34px 7px apart. **M** as a shared-component change.
- **"Vacating Soon" mixes two different dates** (3 hits) — `Notice: 31 Aug`
  beside `Leaving 30 Sep`, unlabelled. Three testers read the first as departed. **S**
- **No payments list** (2 hits) — **CONFIRMS** `BACKLOG.md` → "A payments list page — M". Verified: no `GET /api/payments` exists.
- **No password visibility toggle** — **CONFIRMS** `BACKLOG.md` → "Password fields have no visibility toggle — S". Note the app already ships a correct one inside the portal-password dialog.
- **Tenants list is uninformative** (2 hits) — `Since` renders `created_at`
  (`tenants/page.tsx:114`), so all 22 rows read "Sept 2026"; no room, no balance,
  no portal-access column though `has_portal_login` is already in the response.
- **Approve has no confirmation; Reject does** (2 hits) — on the action that moves money.
- **Pending badge undercounts** (2 hits) — counts registrations only, so waiting payment proofs are invisible in the nav; also stale until reload.
- **The portal never shows the balance** (2 hits) — the number is already computed and correct on the owner's screen for the same tenant.
- **The portal has no headings at all**, no way to contact the owner, and its two forms are visibly from different eras.
- **A new owner is greeted "Welcome back"** (2 hits).
- **Duplicate registrations accepted silently**; phone and Aadhaar accept any characters; `/register/999999` renders a full form and only 404s after upload.
- **"72 characters or fewer" counts bytes** — a 28-character Hindi passphrase is rejected with a message that is factually wrong, in an India-facing app.
- **Whole-cycle billing is described as "Rent is billed up to this date"** — a nine-day change of move-out date swung a settlement by ₹9,000.
- **Adjustments never appear as a line in the settlement tally** — the visible sum reads 18,000 − 22,000 = 5,500.
- **Four date formats** across the app; the portal's `31 Oct 2026` is the best one and the owner app doesn't use it.
- **Payment type is "Online", not "UPI"**; the nudge says "at your convenience" to someone 70 days late and carries no UPI handle.
- **No QR code** though the copy says "or a QR code pointing to it"; the Copy button failed.
- **404s land on Next.js's raw black page**; missing tenant/site redirects silently with no message.

---

## What is genuinely good — do not regress it

Named unprompted, repeatedly, by testers who were being paid to complain:

- **`RecordNoticeDialog`** — four testers called it the best thing in the
  product. It teaches the three-date model in one screen.
- **The delete guard** — real counts, a business reason, a route forward, no
  override, and a disabled-looking control that is itself a tappable "why?".
- **The grid bed drawer** — the complete tenant view. The profile should become it.
- **Insights' footnotes** — "Collected is counted in the month the money
  arrived…". Every headline number deserves this.
- **Collections** — "never paid", "due 70 days ago", room label, actions on the
  row. Best screen in the app on a phone. Two taps to the worst offender.
- **"Place them in a bed now"**, with the submit button relabelling itself to
  "Create & place tenant" — Phase 16's fix landed and worked; C3 did the task in
  90 seconds.
- **The portal-password dialog** — confirm field, Show password, and "Tell it to
  them — you will not be able to read it back." Every signup finding above is
  already solved here.
- **"Sign in with your phone number — not your email"** — Phase 16's copy fix
  landed and was noticed.
- **Charts carry `sr-only` exact values**, so screen readers get real numbers —
  extend that courtesy to touch.
- **Every mutation toasts by name**, and totals update consistently across
  screens.

---

## Verification notes

Per the plan, no finding shipped on a tester's word alone:

- Both retractions were caught by grepping for a call site before writing "there
  is no way to X" — the failure mode `BACKLOG.md` records four times.
- B1, M3, M4, M5, M7, M8 and the `Since` column were confirmed against the
  handlers and components named inline above.
- M2's mechanism was measured live in the browser at 375px, and disagrees with
  both testers' diagnoses — the component is correct, its container is not.
- The `insights.test.ts` blind spot was read directly.
- Charter C1's account and C6's probe accounts remain in the audit database
  (`hostel_ux`), which is isolated from the dev database and disposable.

**Not yet run:** the production pass (stage 2 of the plan) — read-only against
the real account, a throwaway owner for anything that writes, and cold-start
latency timed. It is the only way to see the pooler 500s and the Render sleep.
