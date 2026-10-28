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

---

## Money

---

## Screens

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
