# Backlog write-ups

The list of what is left to do is **not this file**. It is
`~/Projects/board/lists/hostel.md`, one line per item, and `make board` draws
it as a page. How the list, this file and `docs/DONE.md` fit together:
`~/Projects/board/README.md`.

This file holds the longer write-ups, for the few items with more than one
line worth keeping: a design question, the owner's requirements, or something
found the hard way, like a missing API field or a component that has to change.
Most items have no write-up; the line on the board is the whole record.

**Rules:**
- A write-up's `###` heading is the board line's title, word for word. The board
  links the two by that title and warns about a write-up with no line.
- No status and no ✅ here. When an item ships, its write-up moves to the top
  of `docs/DONE.md` in the same PR, and its line comes off the board.
- Closed items live in `docs/DONE.md`, including the ones that older docs and
  code comments point at as `BACKLOG → "…"`.

---

## Next up

### House rules on the registration form
Raised 24 Oct 2026, and the owner called it crucial. Someone registering from
the QR link should see the hostel's basic rules before they submit, for example:
- rent is not refundable
- the deposit comes back only with a month's notice
- no smoking, no drinking

and other basic rules and regulations. Design questions before building:
- Where the rules are written. The owner should be able to edit them, so
  probably a setting, not text in the code.
- Whether the tenant ticks "I agree", and whether that is recorded.
- Whether the same rules show in the portal too.

The deposit rule must match what the move-out sheet does
(`moveOutSettlement`, `noticeBy`): notice by the start of the last rent
month. Today the app says nothing to the tenant about it.

### Link two records of the same person
Before #52, nothing stopped a second record for someone who came back, so
some people may already have their history split across two tenants. Add
tenant and approving a registration now both warn "Same number as …", which
stops new duplicates, but nothing merges two records that already exist.

Tenant login tries every record with that number, newest first, and the
password decides, so duplicates don't sign in at random. Two records with the
same password still sign in to the newer.

---

## Money

### Corrections and write-offs
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

### A list of every payment
The Sep 2026 UX audit: a tester asked "show me all the payments I received this
month", hit "Only the 10 most recent payments are shown", and could not tell
whether September had 10 payments or 30. There is still no `GET /api/payments`.

Since then, Insights became a month table where tapping a month lists every
line in it, and Payments covers who owes. Check with the owner whether that
already answers the question before building a page. If it does not: an
owner-scoped, paginated payments endpoint and a page to match.

---

## Screens

### A loader between pages
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

---

## Ops and security

### Back up the database from the laptop
The only copy of the real data is Neon's own restore history, which on the
free plan covers hours, not weeks (check the exact window in the Neon
dashboard). Now that the data is real, a scheduled `pg_dump` from the owner's
laptop is worth having. The script must not need `NEON_URL` on Claude's side:
he runs anything that holds the connection string himself.

### Deleted tenants' photos and IDs stay in the bucket
Deleting a tenant removes their rows (ON DELETE CASCADE), but their photo and
ID scans stay in R2. They are private and nothing references them, so nothing
can reach them. Still, it is personal data kept for no reason.
`storage.Service` has no Delete yet; adding one, and calling it after the row
is gone, is small. A sweep for unreferenced keys would also catch uploads from
registrations that were rejected.

---

## Parked

Waiting on a trigger, not on time. Each says what the trigger is.

### Isolation tests between owners
**Decision (Aug 2026):** deploy without multi-tenancy isolation tests. With
exactly one owner account there is nobody for an isolation bug to leak *to*, so
the risk is unobservable. Every handler already scopes by `owner_id`; what is
missing is the test proving it, not the scoping.

**The trigger is a second owner signing up, not the deploy.** Before anyone
else gets an account, write the 12b multi-tenancy tests: owner A must not be
able to read or mutate owner B's sites, rooms, beds, tenants, stays or
payments, one test per endpoint family.

### Password reset by email
Parked, but the reasoning above does **not** transfer to it. Isolation bugs
need a second owner to leak *to*; a forgotten password needs nobody but you.

What makes it survivable meanwhile is that the manual path works and is
**written down and rehearsed**: `docs/DEPLOYMENT.md` → "Password recovery".
What that path cannot do is serve a person who is not you, so the trigger is
the same as the isolation tests: **before anyone else has an account.**
Someone locked out who cannot reach the database has no recovery at all, and
"email me your new password" is worse than no reset.

Sizing, so it is not mistaken for a papercut: an email sender (Resend or
Postmark), a `password_reset_tokens` table with expiry and single use, a
request endpoint with its own rate limit, and a reset form. A session on its
own. Signed-in change-password already exists on `/account`.

### A token for /public/upload
A stranger scanning the QR code has to upload their ID before any account
exists, so the endpoint cannot require auth as things stand. The rate limiter
caps abuse but does not remove it: someone with a handful of IPs can still fill
the free tier with arbitrary jpg/png/webp/pdf.

The real fix is a short-lived token issued by `GET /public/owners/:ownerId` and
required by the upload, so an upload has to belong to a registration in
progress. Small change on both sides, worth doing when the QR code goes
somewhere public.
