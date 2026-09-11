# Backlog

Small things worth doing that are not big enough to be a phase. Mostly UX
papercuts found by using the app rather than building it.

`docs/PROGRESS.md` stays the phase-by-phase record; this file is the list of
loose ends. Anything here should be a session's worth of work at most — if an
item grows past that, promote it to a phase in PROGRESS.md and leave a pointer.

**How to add one:** a heading, one line on what a user actually hits, and a size
(S / M). If something was discovered the hard way — a missing API field, a
component that has to change — write that down too, because it is the part that
turns a "quick fix" into an afternoon.

**Capturing between sessions:** noticing these while using the app on a phone is
the point, and that will not happen during a session. Open a GitHub issue in the
moment; they get folded in here at the start of the next session. Do not let the
issue list become a second backlog — this file is the one that gets worked from.

---

---

## Found by the UX audit (Sep 2026) — work this section first

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

### ~~Settling a stay refunds a deposit that may never have been paid~~ ✅ fixed — migration 007
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

### ~~The hover-only fix was applied to one file of four~~ ✅ fixed
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

### The tenant profile is a worse copy of the grid's bed drawer — M, 5 hits
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
now shows the deposit, agreed against received. Still open: `Bed #31` instead
of the room label (M7), and converging on one ledger component with the drawer.

### Three roll-ups disagree, and no tile says how it was computed — S each
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

### ~~Insights charts are drawn off-screen at 375px and cannot be reached~~ ✅ fixed
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

### The grid's "Overdue" filter hides the largest debt in the building — M
A tenant 70 days in arrears who has given notice is filed under `Vacating`, so
HSR's chip reads `Overdue 0` while she owes ₹17,000. The precedence is
deliberate (`grid.go:31-35`) and right for a bed's *colour*; inheriting it for
the *filter* means the chips surface ₹19,500 of ₹47,900. Wants an "owes money"
filter that ignores lifecycle status.

### Nothing can be corrected, anywhere — M
No edit for a payment, no undo for a settlement, no un-approve for a proof, no
way for a tenant to withdraw a notice or fix their own submission, no owner
password change or recovery. Entry is easy on every screen; correction is absent
on every screen. The safety is also inverted: rejecting a registration (which
the applicant can resubmit) confirms; settling a deposit (irreversible, largest
sum in the business) does not. The owner's "Reset portal password" dialog is the
template — it already does confirm, reveal and honest framing.

**Partly fixed (Sep 2026, B3):** `/account` lets an owner change their password
and sign out everywhere, and both now actually revoke — owner tokens carry a
version checked on every request (migration 008). **Recovering a forgotten
password is still the psql runbook** in `docs/DEPLOYMENT.md`: an emailed reset
needs a mail sender, and there is none, so it was scoped out rather than
half-built. Still open here: edit a payment, undo a settlement, un-approve a
proof, a tenant withdrawing a notice, and a confirm step on settling.

### Owner sign-out leaves the tenant session signed in — S
`auth.tsx:61` clears only `hostel_token`. A tester signed the owner out, opened
`/my`, and landed in a tenant's ledger. Front-desk machines are shared. Clear
both keys on either sign-out.

### A rejected payment proof is deleted and the tenant is never told — M
The confirm says "Reject and delete" and means it: the row vanishes from the
tenant's history with no status, no reason, no evidence they ever submitted it.
Soft-reject with a "Not accepted" status instead.

### Settling a tenant erases what they still owe from Collections — M
A settlement that leaves the tenant ₹5,500 down removes them from the chase list
and the dashboard total. The tenant who has already left is the one most likely
to skip. Keep settled stays with a balance under "Moved out — still owes".

### An empty state claims "No sites yet" while sites are loading — S
Three seconds of confident, actionable, wrong instruction on `/tenants/new`,
shown to an owner who has two sites. Render loading before empty.

### Touch targets are under 44px almost everywhere — M, 5 hits
Nudge 32px, inputs 38px, room rename/delete 24px with **zero** gap between them,
portal Sign out 20px, the three stay actions 16px text links 12px apart — one of
which irreversibly settles a deposit. Best fixed once as a minimum height on the
shared `Button` / `Input` / chip components below `lg:`.

### "Vacating Soon" shows two different dates under one heading — S, 3 hits
`Notice: 2026-08-31` beside `Leaving 2026-09-30`, unlabelled. Three testers read
the first as "he left nine days ago" and one said he would have re-let the bed.
The `RecordNoticeDialog` explains this distinction better than anything else in
the product; the dashboard throws it away. Render them as distinct sentences.

### The public half did not get the owner half's care — S each
Raw lowercase server strings (`invalid phone or password`, `registration link
not found`) against the owner side's `Enter the rent amount.`; phone and Aadhaar
accept any characters; a duplicate registration is silently accepted and sorts
*above* the complete one; `/register/999999` renders the whole form and only
404s after three photo uploads; validation errors paint at the top of the form
while focus jumps to the bottom. Also: an unapproved tenant who follows the
success screen's own link is told "invalid phone or password", which is the
wrong answer to a correct password.

### The tenant portal is a stub wearing the product's logo — M
No balance (the number is already computed and correct on the owner's screen for
the same tenant), no deposit, no headings at all, no way to contact the owner,
no payment date or method field, and its two forms are visibly from different
eras. `/my/page.tsx` was untouched by Phase 16.

### Smaller, verified, and cheap — S each
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
- Payment type is "Online", not "UPI". The nudge says "at your convenience" to
  someone 70 days late and carries no UPI handle.
- The registration-link panel promises "or a QR code pointing to it" and the app
  never makes one; the Copy button failed outright.
- 404s land on Next.js's raw black page; a missing tenant or site redirects
  silently with no message.
- `BASE_URL` does not follow `PORT`, so a local backend on a non-default port
  silently breaks every upload with no warning. (This cost the audit two false
  Blockers — see `docs/UX_REVIEW.md` → retractions.)
- The pending queue's "Approve & collect deposit" option and its "Approve &
  record deposit" button still promise to record money. Approving only saves
  the agreed terms. The explanatory line under it was corrected with B1 (it
  claimed "will be recorded as a payment"); the option and button labels were
  not. Found while fixing B1.

---

## Feedback from running the real hostel (Sep 2026) — ✅ all closed

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

### ~~An owner cannot record a vacating notice~~ ✅ fixed
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

### ~~Deleting a room or bed silently destroys stays and payments~~ ✅ fixed
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

### ~~There is no way to rename a room or a bed~~ ✅ fixed
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

### ~~A stay can only be created from the grid~~ ✅ fixed
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

### ~~The known end date has nowhere to go~~ ✅ fixed — migration 006
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

### ~~Tenants added by the owner have no portal account~~ ✅ fixed
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

### ~~The registration form has no photo upload~~ ✅ fixed
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

### ~~Resolved on inspection~~ ✅ the wording is fixed too
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

---

## UX polish

### Password fields have no visibility toggle — S

**Confirmed cold by the Sep 2026 UX audit.** Worth noting the app already ships
a correct one — the portal-password dialog has a working "Show password"
checkbox, a confirm field and helper text. The signup form needs the same group,
not a new component.
Every password field in the app is write-only: `/register/[ownerId]`,
`/my/login`, `/login`, `/signup`. Someone typing a password on a phone keyboard
has no way to check what they typed, and the registration page asks for one they
are inventing on the spot and will need again later.

Belongs in the kit as a `PasswordInput`, not as four separate implementations —
same rule as everything else in `components/ui/`. Needs an accessible toggle
(`aria-label`, `aria-pressed`) and must not break the `Field` label-wrapping
pattern.

### ~~"Vacating soon" on the dashboard is not clickable~~ ✅ fixed in Phase 15d
Both lists now carry `tenant_id` (and the vacating list a `stay_id` to key on)
and every row is a link. The catch recorded here was right: it needed the SQL,
both row structs, both public structs and the TS interfaces, not a `<Link>`
around existing data.

### ~~Collections rows only link to a tenant when the phone is broken~~ ✅ already fixed
`collections/page.tsx:118` links every tenant name; the "Fix phone" link is now
only the fallback it was meant to be. Closed on discovery during Phase 15d.

### A payments list page — M

**Confirmed cold by the Sep 2026 UX audit** — a tester asked "show me all the
payments I received this month", hit "Only the 10 most recent payments are
shown", and could not tell whether September had 10 payments or 30. Re-verified:
no `GET /api/payments` route exists.
Neither dashboard list has a "view all" destination: there is no `GET
/api/payments` endpoint at all, and `/tenants` has no notice filter. The lists
are capped at 10 and now say so, which is honest but not a way to see the 11th.
Wants an owner-scoped, paginated payments endpoint and a page to match.

---

## Observability

Full picture in `docs/DEPLOYMENT.md` → "Where the logs go".

### ~~50 handlers return a 500 and discard the error~~ ✅ done
`serverError(c, err, msg)` logs method, route, message and cause behind all of
them. One chokepoint, so error tracking wires in once rather than seventy times.

### ~~19 `db.Get` / `db.Select` calls drop their error entirely~~ ✅ done
They were ownership checks: a failed query left `count` at 0, so the handler
answered "not found" and a database problem looked like a missing record.

### ~~The frontend has no `global-error.tsx`~~ ✅ done
`error.tsx` and `global-error.tsx`, both reporting through `lib/reportError.ts`.

### ~~No error tracking or alerting~~ ✅ done (Sep 2026)
Sentry, EU region, wired into the two existing chokepoints plus panics and boot
failures. Scrubbing is verified against a captured wire payload, not assumed —
see `docs/DEPLOYMENT.md` → "Verified, not assumed". Alert rules and the one
thing the scrubber deliberately does not cover (names) are documented there too.
Still needs a human to create the account and paste the two DSNs.

## Security / privacy

### Tenant ID scans live at permanent public URLs — M, and gets worse with time

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

### The app collects full Aadhaar numbers and card images — M, and it is a product question first
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

### `ValidateUploadedURL` checks the extension, not the host — S
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

### `/public/upload` is unauthenticated by design — S, once registration has a token
A stranger scanning the QR code has to upload their ID before any account exists,
so the endpoint cannot require auth as things stand. The rate limiter caps abuse
but does not remove it: someone with a handful of IPs can still fill the free
tier with arbitrary jpg/png/webp/pdf.

The real fix is a short-lived token issued by `GET /public/owners/:ownerId` and
required by the upload, so an upload has to belong to a registration in progress.
Small change on both sides — worth doing when the QR code goes somewhere public.

---

## Found by Sentry (Sep 2026, first hour)

Both of these were live in production and invisible before error tracking.
Neither was found by a test or by reading code — they arrived as issues from
one signup.

### `/api/collections` intermittently 500s — prepared statements crossing connections — **cause confirmed, one env var away from fixed**
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

**Remaining work is one env var**, and it is not something Claude can do — the
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

### ~~Passwords over 72 bytes return 500 instead of 400~~ ✅ done (Sep 2026)
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

## Correctness / consistency

### Collections and the dashboard disagree about bed-less stays — S

**Rediscovered independently by two testers in the Sep 2026 UX audit**, on a link
whose own subtitle reads "chase it from Collections →". Measured: ₹40,400 vs
₹47,900, the gap being exactly one bed-less tenant.
`GET /api/collections` includes stays with no bed assigned; the dashboard's
`overdue_amount` excludes them (`s.bed_id IS NOT NULL`). An owner who has taken
a deposit without allocating a room sees two different totals for the same
money. Probably fixed by dropping the dashboard's filter, but that changes a
tested figure, so it wants its own change rather than riding along with
something else. Flagged during Phase 10.

### No rate limiting on the remaining public endpoints — M

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

### ~~`frontend/.env.example` does not exist~~ ✅ done
Added before the deploy. One variable, `NEXT_PUBLIC_API_URL`, with a note that
missing it on Vercel produces a clean build whose every request then fails
against localhost in the browser.
