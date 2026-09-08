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

## Feedback from running the real hostel (Sep 2026) — work this section first

Found by the owner using the live app against real tenants, not by building it.
These come **before** the sections below: they are small, and each one is
something that blocked or misled a real person on a real evening.

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

### There is no way to rename a room or a bed — S
Backend `PUT /api/sites/:siteId/rooms/:id` and
`PUT /api/sites/:siteId/rooms/:roomId/beds/:id` both exist and work.
`roomsApi.update` and `bedsApi.update` both exist in `lib/api.ts`. Neither has
a single call site in the app or the tests. Built, wired, never surfaced — this
is a form and nothing else. Add/delete are already on the site page; rename
sits beside them.

### A stay can only be created from the grid — M
`/tenants/new` creates a *person*: name, phone, Aadhaar, photos, and nothing
about where they will sleep. The only call to `staysApi.create` in the entire
frontend is `sites/[id]/grid/page.tsx:390`. So adding a tenant means: fill the
tenant form, then navigate to Sites → the site → the room → the bed → assign.
The "Assign bed" button on the tenant page only rescues a stay that already
exists without a bed, which only happens via pending-registration approval.

Wants an optional "place them now" step on the tenant form — bed, rent,
deposit, cycle, start date — reusing the grid's assign form rather than growing
a second one that can drift from it (the same drift that
`EndStayDialog` was created to end).

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

### Tenants added by the owner have no portal account — S/M
`TenantAuthHandler.Login` requires `password_hash IS NOT NULL`
(`tenant_auth.go:46`). The password is collected only by the public
registration form; owner-side `TenantHandler.Create` never inserts one
(`tenants.go:87`). So every tenant the owner adds by hand is permanently locked
out of `/my` — which is how the vacating-notice gap became total rather than
merely annoying.

Two ways out, and they are not exclusive: let the owner set or reset a portal
password from the tenant page, and/or send the registration link to a tenant
who was added manually. Worth deciding before more owner-created tenants
accumulate on the live account.

### The registration form has no photo upload — S
`/register/[ownerId]` uploads ID front and ID back, and the payload carries no
`photo_url` at all (`register/[ownerId]/page.tsx:147`) — even though `tenants`
has the column and the owner-side form has the field. The tenant is standing
there with a phone; that is the cheapest moment in the whole system to get a
face on the record. `uploadApi.publicUpload` already handles it, so this is one
more `UploadField` and one more line in the payload.

(Recorded alongside: the file-picker flow itself was called out as working
beautifully on a phone. Do not regress it while adding the field.)

### Resolved on inspection — no action
- **"What email does the tenant log in with, if email is optional?"** They do
  not. Portal login is **phone + password** (`tenant_auth.go:46`); email never
  participates in auth and is stored for contact only. Nothing to fix in the
  code — but the registration form's Email field says nothing about this, and
  the owner reasonably assumed otherwise. Worth a hint on the field, and worth
  saying plainly on `/my/login`.

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

### ~~"Vacating soon" on the dashboard is not clickable~~ ✅ fixed in Phase 15d
Both lists now carry `tenant_id` (and the vacating list a `stay_id` to key on)
and every row is a link. The catch recorded here was right: it needed the SQL,
both row structs, both public structs and the TS interfaces, not a `<Link>`
around existing data.

### ~~Collections rows only link to a tenant when the phone is broken~~ ✅ already fixed
`collections/page.tsx:118` links every tenant name; the "Fix phone" link is now
only the fallback it was meant to be. Closed on discovery during Phase 15d.

### A payments list page — M
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
`GET /api/collections` includes stays with no bed assigned; the dashboard's
`overdue_amount` excludes them (`s.bed_id IS NOT NULL`). An owner who has taken
a deposit without allocating a room sees two different totals for the same
money. Probably fixed by dropping the dashboard's filter, but that changes a
tested figure, so it wants its own change rather than riding along with
something else. Flagged during Phase 10.

### No rate limiting on the remaining public endpoints — M
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
