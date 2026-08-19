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

## UX polish

### Password fields have no visibility toggle — S
Every password field in the app is write-only: `/register/[ownerId]`,
`/my/login`, `/login`, `/signup`. Someone typing a password on a phone keyboard
has no way to check what they typed, and the registration page asks for one they
are inventing on the spot and will need again later.

Belongs in the kit as a `PasswordInput`, not as four separate implementations —
same rule as everything else in `components/ui/`. Needs an accessible toggle
(`aria-label`, `aria-pressed`) and must not break the `Field` label-wrapping
pattern.

### "Vacating soon" on the dashboard is not clickable — S, but backend first
Seeing that someone is moving out and not being able to click through to them is
the wrong answer to the obvious next question. Same for the recent-payments list
next to it.

**The catch:** `VacatingTenant` and `RecentPayment` in `dashboard.go` return
`tenant_name` and no `tenant_id` — the queries join `tenants` but never select
the id. So this is an API change plus a frontend one, not a `<Link>` around
existing data.

### Collections rows only link to a tenant when the phone is broken — S
The row already renders a "Fix phone" link to `/tenants/:id` when the number is
unusable, so the id is right there. The tenant's name should be a link in every
row — chasing a payment and wanting the full ledger is one thought.

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

### No error tracking or alerting — M, needs an account
The remaining gap, and the one that matters once this is live: errors reach
stdout on Render, which is a tail with short retention and no alerting, and
client-side errors reach only the user's own browser console. Sentry or
self-hosted GlitchTip — it is account #5 in the deployment guide's setup table.
Small change now that both chokepoints exist.

## Correctness / consistency

### Collections and the dashboard disagree about bed-less stays — S
`GET /api/collections` includes stays with no bed assigned; the dashboard's
`overdue_amount` excludes them (`s.bed_id IS NOT NULL`). An owner who has taken
a deposit without allocating a room sees two different totals for the same
money. Probably fixed by dropping the dashboard's filter, but that changes a
tested figure, so it wants its own change rather than riding along with
something else. Flagged during Phase 10.

### No rate limiting on the public endpoints — M
`/auth/login` and `/public/register/:ownerId` are unthrottled. Low risk while
the registration link is on a fridge; a real one the day it is printed on a QR
code by the door. Tracked in PROGRESS.md under Deferred as well, because it is
also a go-live consideration.

### `frontend/.env.example` does not exist — S
`backend/.env.example` does. The frontend needs `NEXT_PUBLIC_API_URL` and
nothing else, but a deploy walkthrough that mentions one and not the other is
how a variable gets missed.
