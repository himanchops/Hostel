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

Revisit the "You're registered" screen in the same pass (owner, 27 Oct
2026). Its steps say the owner checks the details, you'll hear from them,
"then sign in with your phone number and password". What really happens is
the owner checks the details, gives them a room and bed, and they move in;
most never sign in. Say that, and mention the portal as something they can
use if they need it: sending a payment proof, giving notice.

---

## Money

---

## Screens

---

## Ops and security

### After a quiet spell the app hangs, then fails
Owner, 27 Oct 2026: after a quiet spell, opening the site showed a spinner
until a refresh, then the login page, though he had been signed in. After
signing in, Insights took a long time and showed "Failed to fetch
(hostel-backend-k7ar.onrender.com)"; Retry loaded it at once.

The cause is Render's free plan: the backend sleeps after about 15 minutes
without a request, and the first request after that waits about a minute
while it wakes. Three things in our code make that minute worse:
- The root page (`app/page.tsx`) shows a bare spinner while `authApi.me`
  checks the stored sign-in. It is not `PageLoader`, so it never says the
  server is waking, and nothing gives up.
- `contexts/auth.tsx` forgets the token when that check fails for *any*
  reason, so a dropped connection to a sleeping server signs the owner out.
  Only a 401 should.
- `request()` in `lib/api.ts` shows the browser's own "Failed to fetch"
  (a request that got no answer at all, likely the server mid-wake; not
  confirmed from Render's logs) and never tries again.

Two fixes, not exclusive:
- **Keep it awake:** a free outside pinger (cron-job.org or UptimeRobot)
  calling `/health` every 10 minutes. One always-on service fits Render's
  free monthly hours. `/health` doesn't touch the database, so Neon still
  sleeps. Owner's setup, not code.
- **Client fixes:** keep the sign-in on a network failure, retry once when
  the connection drops, `PageLoader` on the root page, and a plain sentence
  instead of "Failed to fetch". A small frontend PR.

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
