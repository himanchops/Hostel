# Deployment

Step-by-step guide to deploying the app to a free/cheap public stack.

> **Live as of Aug 2026.**
> Frontend: https://hostel-ten-kappa.vercel.app
> Backend: https://hostel-backend-k7ar.onrender.com
>
> The steps below are kept as the record of how it was set up, and as the guide
> for doing it again. For day-to-day operation the things worth remembering are:
> run `make migrate DATABASE_URL="$NEON_URL"` before deploying any schema
> change, and editing `render.yaml` on master applies to production
> automatically.

**Target stack**
- Backend (Go) → Render
- Database (Postgres) → Neon
- File storage → Cloudflare R2
- Frontend (Next.js) → Vercel

**Cost:** $0/mo on free tiers. ~$7/mo if you upgrade the Render service to keep the backend always-on.

This document covers Phase 9.2–9.6 (the actual deploy). For the code prep that
makes this possible — `S3Storage`, `render.yaml`, `.env.example` — see Phase 9.1.

---

## Accounts to create first (do these in one sitting)

Every step below stalls on one of these, and each needs a human at a signup
form — Claude cannot create accounts or enter credentials. Get them all out of
the way in one go, keep the secrets somewhere you can paste from, and the rest
of the guide is mostly copying values between dashboards.

| # | Service | What for | What you leave with |
|---|---|---|---|
| 1 | [Neon](https://neon.tech) | Postgres | `DATABASE_URL` |
| 2 | [Cloudflare](https://dash.cloudflare.com) (R2) | Tenant photos and ID documents | Account ID, access key + secret, bucket name, public bucket URL |
| 3 | [Render](https://render.com) | The Go backend | — (reads `render.yaml`; you paste the secrets in) |
| 4 | [Vercel](https://vercel.com) | The Next.js frontend | — (you set `NEXT_PUBLIC_API_URL`) |
| 5 | [Sentry](https://sentry.io) (**EU region**) | Seeing errors after they happen | two DSNs — one backend, one frontend |

### Decisions taken (Aug 2026)

Both of these were open questions in earlier drafts of this doc. They are
settled; the reasoning is here so it does not get re-litigated next session.

**Error tracking: skipped for this deploy.** ✅ **Superseded — done Sep 2026.**
It was the right call for a deploy day and the wrong one the moment strangers
could reach the app. See "Where the logs go" below for what was built; the
reasoning that settled Sentry-over-GlitchTip is in "Choosing a tracker".

**R2 bucket: public.** Object keys are `public/<32 hex chars>.ext` generated
from `crypto/rand` (`backend/internal/handlers/upload.go`) and the r2.dev
subdomain does not list directories, so the model is unguessable-link, not
browsable — the same posture as a "anyone with the link" document share. What
you accept in exchange: those URLs never expire and are readable by anything
that ever observes one.

Public also made `POST /public/upload` — unauthenticated, because a stranger
scanning the QR code uploads their ID before any account exists — into an open
file host on the Cloudflare account. **That is now rate-limited per client IP**
(`middleware.PublicUploadRateLimiter()`, 10-upload burst refilling one per three
minutes). Note that this raises the cost of abuse rather than removing it.

Both of the follow-ups these imply — presigned URLs, and a registration token
gating the upload — are written up in `docs/BACKLOG.md` under "Security /
privacy". The presigned-URL one gets more expensive with every real tenant row,
because the DB stores absolute URLs rather than keys.

---

## 1. Database (Neon) — ~10 min

1. Sign up at https://neon.tech (see the accounts table above).
2. Create a new project. Region: **Singapore**, to match `region: singapore` in
   `render.yaml` — every request the backend serves makes at least one DB round
   trip, so a mismatch here is felt on every page.
3. Once created, copy the **connection string** and export it once, so it stays
   out of your shell history's reach and out of anything you paste elsewhere:
   ```bash
   export NEON_URL='postgres://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require'
   ```
4. From your laptop, run the migrations against the new database:
   ```bash
   migrate -path backend/migrations -database "$NEON_URL" up
   ```
5. **Verify the schema actually landed** — not optional. A half-applied
   migration and a fully-applied one both leave tables behind, and the
   difference only shows up as a confusing 500 after deploy.
   ```bash
   migrate -path backend/migrations -database "$NEON_URL" version
   ```
   Must print `5` — the number of migrations in `backend/migrations` — with no
   `(dirty)` suffix. If it says dirty, a migration failed partway: fix the cause,
   `migrate ... force <n>` back to the last good version, and re-run `up`. Do not
   just run `up` again.
   ```bash
   psql "$NEON_URL" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
   ```
   Expected, exactly nine lines: `beds`, `hostel_sites`, `owners`, `payments`,
   `rooms`, `schema_migrations`, `settlements`, `stays`, `tenants`.

> **Future migrations:** every time you ship a new schema change, run this
> against Neon *before* deploying the new backend binary:
>
> ```bash
> make migrate DATABASE_URL="$NEON_URL"
> ```
>
> It echoes `LOCAL` or `REMOTE` first and prints the resulting version, so a
> mis-set variable is visible rather than silent. Bare `make migrate` targets
> the local database — it used to be hardcoded to localhost, which meant a
> deploy-time migration could report success having touched the wrong database
> entirely, and the missing column then surfaced as a 500 in production.
>
> `make seed-demo-reset` is deliberately **not** overridable this way; it writes
> rows, so it stays pinned to local. Clear the seed owner from a deployed
> database by hand instead:
>
> ```bash
> psql "$NEON_URL" -c "DELETE FROM owners WHERE email = 'demo@seed.invalid';"
> ```
>
> Until automation is in place this is all manual. The expected `version` number
> goes up by one per migration, so re-derive it from
> `ls backend/migrations/*.up.sql | wc -l` rather than treating 5 as a constant.

---

## 2. File storage (Cloudflare R2) — ~10 min

1. Sign up at https://cloudflare.com (no credit card needed for R2 free tier).
2. In the dashboard sidebar, click **R2** → "Create bucket". Name it e.g. `hostel-uploads`.
3. Note your **account ID** (shown on the R2 dashboard). The S3 endpoint is:
   ```
   https://<account-id>.r2.cloudflarestorage.com
   ```
4. Click into the bucket → **Settings** → **Public access** → enable
   "R2.dev subdomain". This gives you a public URL like:
   ```
   https://pub-<hash>.r2.dev
   ```
   Objects you upload will be readable at `<that-URL>/<key>`.
5. Back in the R2 dashboard → **Manage R2 API Tokens** → "Create API token".
   Permission: "Object Read & Write". Scope: the bucket you just created.
   Copy the **Access Key ID** and **Secret Access Key** — you only see them once.

You now have the 5 values you need:
- `S3_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`
- `S3_BUCKET` = `hostel-uploads`
- `S3_ACCESS_KEY` = (from the API token)
- `S3_SECRET_KEY` = (from the API token)
- `S3_PUBLIC_URL` = `https://pub-<hash>.r2.dev`

---

## 3. Backend (Render) — ~15 min

1. Push the current branch to GitHub if you haven't already.
2. Sign up at https://render.com. Connect your GitHub account.
3. Click **New** → **Blueprint**. Pick this repo.
   Render reads `render.yaml` and proposes the service.
4. Render will prompt for the env vars marked `sync: false`. Fill in:
   - `DATABASE_URL` → the Neon connection string from step 1.
   - `FRONTEND_URL` → `https://placeholder.invalid` for now; replaced in step 5.
     Prefer a placeholder over leaving it empty: empty selects the *dev* CORS
     path, which allows loopback and LAN origins and logs "FRONTEND_URL unset —
     dev mode". Not a hole — an attacker origin is a public domain and is
     rejected either way — but a misleading line to leave in a production log.
     `.invalid` is RFC 2606 reserved, so it cannot resolve to anything real.
   - `BASE_URL` → can stay empty when using S3.
   - `S3_ENDPOINT` → **host only**, no bucket path. The R2 dashboard displays it
     as `https://<account-id>.r2.cloudflarestorage.com/<bucket>`; the bucket is a
     separate variable and the SDK uses path-style addressing, so leaving the
     suffix on produces `.../<bucket>/<bucket>/key` and 404s.
   - `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` → from step 2.
     The R2 token screen shows a prominent **"Token value"** — that is for
     Cloudflare's own API, not S3. You want the *Access Key ID* and *Secret
     Access Key* below it; the token value fails with a signature error that
     reads like a typo.

   Set for you by `render.yaml`, no action needed: `JWT_SECRET` (generated),
   `STORAGE_BACKEND=s3`, `S3_REGION=auto`, and `GO_VERSION`. That last one
   exists because `backend/go.mod` requires a Go version newer than Render's
   default and carries no `toolchain` directive — without it the build fails
   with "go.mod requires go >= …", which reads like a dependency problem.
   **Bump it in `render.yaml` whenever the `go` directive in `backend/go.mod`
   moves.**
5. Click "Apply". Render builds and deploys. First build takes ~5 min.
6. Once deployed, Render shows the service URL, e.g. `https://hostel-backend.onrender.com`.
   Hit `/health` in a browser — should return `{"status":"ok"}`.
7. Run the storage smoke test from your laptop (any small image will do):
   ```bash
   cd backend && STORAGE_BACKEND=s3 \
     S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com" \
     S3_BUCKET="hostel-uploads" \
     S3_ACCESS_KEY="<access-key>" \
     S3_SECRET_KEY="<secret-key>" \
     S3_PUBLIC_URL="https://pub-<hash>.r2.dev" \
     go run ./cmd/storage-check --file ./some-image.png
   ```
   It should print `Backend: *storage.S3Storage`, then "OK" and a URL. Check
   that backend line — the selector falls back to local storage on an
   unrecognised `STORAGE_BACKEND` rather than erroring, so `*storage.LocalStorage`
   means the variable did not reach the process and the test proved nothing.
   Open the URL in a browser — if you see the image, R2 is wired correctly.

   > The `cd` comes **first** on purpose. An earlier version of this doc put the
   > assignments before `cd backend && go run ...`; prefix assignments apply only
   > to the `cd`, so every variable was gone by the time `go run` started and the
   > check silently exercised local disk. `make storage-check FILE=path/to.png`
   > has the same trap — it does not set the S3 variables at all, so it only
   > works if they are already exported in your shell.

---

## 4. Frontend (Vercel) — ~10 min

1. Sign up at https://vercel.com. Connect your GitHub account.
2. Click "Add New…" → "Project" → pick this repo.
3. **Root Directory:** `frontend`. Not optional, and not merely cosmetic —
   Vercel auto-detects the monorepo and will otherwise propose deploying the Go
   backend as `/api/backend` alongside the frontend, prompting for a
   `vercel.json` to formalise it. **Decline that.** Echo is a long-lived HTTP
   server, not a request-scoped function; the result is a second, unconfigured
   copy of an app that handles government ID sitting at a public URL. Setting
   the root directory collapses the detection to a single Next.js service and
   the prompt disappears.
4. **Environment Variables:**
   - `NEXT_PUBLIC_API_URL` = the Render backend URL from step 3.6.
5. Click "Deploy". First build takes ~3 min.
6. Once live, Vercel shows the URL, e.g. `https://hostel-xxx.vercel.app`.

---

## 5. Wire frontend ↔ backend — ~5 min

1. Go back to Render → your backend service → **Environment** tab.
2. Update `FRONTEND_URL` to the Vercel URL from step 4.6. **Exactly** — `https://`,
   no trailing slash, no `www`. CORS compares the `Origin` header as a literal
   string, so a trailing slash yields a configuration that looks complete and
   refuses every request, with no symptom outside the browser console.
3. Render auto-redeploys. Verify the handshake from the command line before
   opening the UI, so a mistake reports itself instead of showing a blank page:
   ```bash
   # must return an access-control-allow-origin header
   curl -s -o /dev/null -D - -X OPTIONS "$RENDER_API_URL/auth/login" \
     -H "Origin: $VERCEL_APP_URL" -H "Access-Control-Request-Method: POST" \
     | grep -i access-control-allow-origin

   # must return NOTHING — proves the match is exact, not a prefix
   curl -s -o /dev/null -D - -X OPTIONS "$RENDER_API_URL/auth/login" \
     -H "Origin: $VERCEL_APP_URL/" -H "Access-Control-Request-Method: POST" \
     | grep -i access-control-allow-origin
   ```
4. Visit the Vercel URL. Sign up an owner. Verify:
   - Login works.
   - You can create a site, room, bed.
   - You can register a tenant through the public link (upload an ID proof — this
     is the end-to-end R2 test, and the only path that exercises the upload rate
     limiter in production).
   - The image URL in the tenant profile should point at `pub-xxx.r2.dev`, not `localhost`.
   - Open the uploaded image URL in a private window. It should load — that is
     the public-bucket decision working as intended, not a bug.

---

## Troubleshooting

**CORS errors in the browser console.** `FRONTEND_URL` on Render doesn't match the actual Vercel URL exactly (including https/http and trailing slash). Update it and redeploy.

**File uploads succeed but the URL 403s.** The R2 bucket's "Public access" subdomain isn't enabled, or `S3_PUBLIC_URL` doesn't match the `pub-xxx.r2.dev` URL.

**Uploads start failing with "too many uploads from this network".** The
per-IP limiter on `/public/upload` (10 burst, one token back every three
minutes). Expected if you are testing repeatedly from one address; wait it out,
or restart the Render service, since the store is in-memory and resets with the
process. If real tenants hit it, the numbers are in
`backend/internal/middleware/ratelimit.go`.

**Backend cold starts take ~30s.** Render free tier spins down after 15 min idle. Upgrade to the `starter` plan ($7/mo) to keep it warm.

**Database connection errors after some idle time.** Neon's free tier suspends compute after ~5 min of inactivity; the first request after wake-up takes a second or two. Normal.

---

## Where the logs go (read this before you need it)

**Short version: a 500 now reaches an inbox, not just a terminal nobody is
watching.** Worth knowing the shape of it before something breaks at 11pm
rather than after.

| Source | Where it lands | Retention | Anyone told? |
|---|---|---|---|
| Backend request lines | Render's log tab (stdout) | short, and rolls off | no |
| Backend 500s | Render's log tab **and Sentry** | 90 days in Sentry | **yes — email on a new issue** |
| Backend panics | Render's log tab **and Sentry**, with a stack trace | 90 days | **yes** |
| Backend boot failures (no DB, no storage) | stdout **and Sentry**, flushed before exit | 90 days | **yes** |
| Frontend crashes in the browser | **Sentry**, with breadcrumbs and the route | 90 days | **yes** |
| Postgres | Neon's own console | per Neon's plan | no |

Render still captures stdout, and that is still the fastest way to watch a
deploy in real time. What it never was is a record: no grouping, no history, and
nothing raises a hand. Sentry is the record; Render is the tail. Keep both.

### Choosing a tracker (Sep 2026)

**Sentry, EU region.** Re-examined from scratch now the app is live rather than
inherited from the pre-deploy note, and one leg of the earlier argument turned
out to be wrong.

*What was wrong.* The Aug 2026 note said any tracker "would collect by default
the request URL, the `Authorization` header, and registration request bodies".
That is no longer true of the Go SDK. As of `sentry-go` v0.49 the default with
`SendDefaultPII: false` collects **no** request bodies at all, drops cookies,
and runs headers through a deny-list that matches `auth` — so `Authorization`
was already redacted before we wrote a line of scrubber. The conclusion held;
the mechanism behind it did not. This matters because the old note implied the
scrubber was load-bearing. It is not: the *configuration* is load-bearing, and
the scrubber is the second layer that catches what configuration cannot reach.

*What is actually the risk.* Free text. A value interpolated into an error
string — by us, by `lib/pq`, by a validation message — is invisible to every
header and body setting there is. That is the one thing `BeforeSend` is for
here, and it is why the scrubbing is pattern-based on Aadhaar, Indian mobile
numbers and email addresses rather than field-name-based.

*Why not GlitchTip.* The case for it was never the protocol — GlitchTip speaks
the same one, which is exactly why the choice stays reversible for the price of
an env var. The case against it is that self-hosting means a VM, a Postgres and
a Redis to run, patch and watch, for an app whose whole backend is one free
Render service. An unwatched monitoring stack is worse than no monitoring
stack: it fails silently and you find out by not being told about an outage.
The privacy argument that would justify that cost does not survive contact with
what actually leaves the process — see "Verified, not assumed" below.

*Why the EU region.* The honest answer is that on substance it is close: Sentry
is a US company either way, so a US legal process reaches both regions, and the
transport is async so latency from Singapore is irrelevant. Two things break
the tie. First, **the region cannot be changed** — Sentry's own docs are
explicit that switching means creating a new organization and abandoning the
event history, making this the only irreversible decision in the whole change.
Second, the data subjects are Indian tenants and the app holds Aadhaar numbers;
India's DPDP Act is modelled closely on GDPR, so if a data-processing story is
ever needed, "EU region, under Sentry's GDPR DPA" is a shorter one to tell than
its US equivalent. When one option is irreversible and the substance is a
coin-flip, take the one you cannot regret.

### Verified, not assumed

"Configured a scrubber" and "confirmed nothing sensitive left the process" are
different claims. What follows is the second one. The method: point `SENTRY_DSN`
at a local HTTP server that captures envelopes verbatim, run the real binary,
trigger real errors, and read the bytes.

Sent deliberately, on a real request to `POST /public/register/:ownerId`:
an `Authorization: Bearer …` header, a `Cookie`, an `X-Api-Key`, an
`X-Forwarded-For`, a `?token=` query parameter, and a full registration body
(name, phone, email, Aadhaar, password, ID-proof URL).

What reached the wire:

```
request.data:         None            ← body never collected
request.cookies:      None
request.headers:      {Content-Type, Host, User-Agent}   ← nothing else
request.query_string: end_date=2026-09-01&token=[Filtered]
exception value:      pq: relation "owners" does not exist at column 29 (42P01)
fingerprint:          [POST, /public/register/:ownerId, failed to verify …]
```

A byte-level scan of the captured payload for each planted secret came back
absent for all of them, while the Postgres cause — the part worth reading —
survived intact. The frontend was checked the same way, by crashing a component
inside the real error boundary: phone, Aadhaar and email were `[redacted]`
everywhere including the console breadcrumbs, with a 12-frame stack trace and
the route preserved.

Both halves are also covered by unit tests, so this does not depend on anyone
repeating the exercise: `backend/internal/observability/sentry_test.go` and
`frontend/tests/unit/scrub-pii.test.ts`. The Go test drives the SDK's own
request builder, so it fails if a future SDK version changes what it collects.

### What the scrubber does not cover

**Names.** `scrubPII("could not render tenant Priya Sharma")` returns that
string unchanged, and there is a test asserting exactly that so it cannot
change by accident. A name is not matchable by pattern — anything that caught
"Priya Sharma" would also eat "Postgres Error" — so names stay out of the
tracker by a convention rather than a filter:

> Do not interpolate tenant fields into error messages. `serverError(c, err,
> "failed to load tenant")` is right; `fmt.Errorf("failed to load %s", name)`
> is not.

Structured data is safe regardless, because request bodies are never collected.
The convention only governs strings we build ourselves.

**Aadhaar-shaped collateral.** A 12-digit run is redacted wherever it appears,
so a genuinely 12-digit id in an error message would be lost. That is the
intended trade and the tests pin both sides of it: ids like `42` and paise
amounts like `250000` are explicitly asserted to survive.

### Setup — the part that needs you

Claude cannot create the account or hold the DSN. Everything below is yours.

**1. Create the org in the EU region.** At signup, Sentry asks for a data
storage location once and never again. Pick **EU (Frankfurt)**. A DSN that
contains `.ingest.de.sentry.io` is EU; `.ingest.us.sentry.io` is US and means
starting over.

**2. Create two projects**, not one: platform **Go** (`hostel-backend`) and
platform **Browser JavaScript** (`hostel-frontend`). Two projects means the
alert rules below can differ, and a frontend crash loop cannot bury a backend
outage in the same issue stream.

**3. Paste the backend DSN into Render** → the `hostel-backend` service →
Environment → `SENTRY_DSN`. `SENTRY_ENVIRONMENT` is already set to `production`
by `render.yaml`. Save; Render redeploys.

**4. Paste the frontend DSN into Vercel** → Settings → Environment Variables →
Production:

```
NEXT_PUBLIC_SENTRY_DSN=<the frontend DSN>
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

Then redeploy — `NEXT_PUBLIC_` variables are inlined at build time, so an
existing build will not pick this up. `NEXT_PUBLIC_COMMIT_SHA` is derived from
Vercel's own `VERCEL_GIT_COMMIT_SHA` in `next.config.ts`; do not set it by hand.

The frontend DSN is inlined into the browser bundle and is readable by anyone.
That is how browser error tracking works — a DSN grants permission to *send*,
not to read. The only real exposure is quota abuse; if it happens, rotate the
key in the project's client-keys settings.

**5. Confirm both actually arrive.** This is the step worth not skipping,
because a DSN that is set but silently failing looks exactly like a quiet week.

Backend — check the boot log in Render first. It says one of three things, and
they are deliberately distinguishable:

```
error tracking: enabled (environment=production release="…")
error tracking: DISABLED (SENTRY_DSN unset) — 500s will only reach stdout
error tracking: FAILED to initialise (…) — 500s will only reach stdout
```

Then make it produce a real 500 rather than trusting the log line. The simplest
honest way is to break something briefly: in Render, set `DATABASE_URL` to a
deliberately wrong value, save, and load the public registration page. The boot
failure itself is reported (`Fatalf` flushes before exiting) and the issue
should appear within a minute. Put the real value back afterwards.

Frontend — open the deployed app, and in the browser console run
`setTimeout(() => { throw new Error("sentry smoke test") })`. It should appear
in the `hostel-frontend` project within a minute.

If nothing arrives, set `SENTRY_DEBUG=1` on Render and redeploy. The SDK then
prints transport failures to stdout — a blocked or wrong DSN shows up as a
plain `HTTP request failed: … connection refused` line rather than as silence.
Turn it back off once diagnosed; it is noisy.

### Alerting — what should email you, and what should not

Tracking without a notification is still "only if you look". Noisy alerting is
worse: it trains you to ignore the one that mattered. The rule applied here is
that an alert must correspond to something you would actually do tonight.

**Email me:**

| Rule | Project | Why |
|---|---|---|
| A **new** issue is seen (`is:unresolved` + first seen) | both | The whole point. A failure mode that has never happened before is the one worth reading about. |
| An issue's event count exceeds **10 in 1 hour** | backend | Distinguishes "one tenant hit a bad row" from "the app is down". |
| Any issue tagged `route:/public/*` | backend | The QR registration path is the one strangers reach with no account and no way to report a problem to you. |
| A **regression** (a resolved issue reopens) | both | Means a fix did not hold, which is a different and more urgent fact than a new bug. |

**Do not email me:**

- *Every* event on an existing issue. Once an issue is known, the tenth
  occurrence carries no new information and forty emails guarantee the next
  genuinely new issue is skimmed past.
- Anything from `environment:development`. Local crashes are not incidents.
  This is why `SENTRY_ENVIRONMENT` is set explicitly on both services rather
  than left to default.
- Neon cold-start connection errors. The free tier suspends compute after ~5
  minutes idle and the first request afterwards can fail. If these turn up as
  an issue, resolve it as "ignore until it happens 10 times in an hour" rather
  than deleting the rule — the pattern only matters at volume.
- Spikes and performance alerts. Tracing is off (`tracesSampleRate: 0`), there
  is no baseline to compare against, and a hobby-tier app with a handful of
  users would produce nothing but false positives.

Set these under **Alerts → Create Alert Rule** in each project, with email to
your own address as the only action. Sentry's default "alert on every new
issue" rule is close to the first row already — check it exists before adding a
duplicate.

### The plan, in the order it is worth doing

1. ~~**Stop discarding errors.**~~ ✅ Done. One `serverError` helper logs the
   cause behind every backend 500, and the 19 `db.Get` calls that silently
   dropped their error — turning a database failure into a misleading 404 —
   now check it. This was the step that made everything after it useful.
2. ~~**Add an error boundary.**~~ ✅ Done. `error.tsx` and `global-error.tsx`
   catch client-side crashes, reporting through `lib/reportError.ts`.
3. ~~**Error tracking.**~~ ✅ Done, Sep 2026. It stayed a small change because
   steps 1 and 2 had already built the chokepoints: `serverError` and
   `reportError` are still the only places that report. The backend additions
   beyond that were the two things those chokepoints cannot see — panics, via
   `RecoverWithConfig`, and boot failures, via `observability.Fatalf`, which
   exists because `log.Fatal` calls `os.Exit` and skips every deferred flush.
4. **Log drain** (optional, later). Render can forward stdout to Better Stack
   or Papertrail for searchable retention. Less pressing now that the errors
   worth keeping are kept elsewhere; still the answer if you ever need to search
   *request* logs rather than error logs.

**Rule going forward:** a 500 that reaches a user and leaves no trace is a bug
in its own right, separate from whatever caused it. See CLAUDE.md.

## The live owner account (Sep 2026)

Production is not just demo data any more. **Chopra Boys Hostel** is on it:
owner #4 (`lnchopra66@yahoo.co.in`), site #1, 7 rooms, 45 beds. The structure
was seeded; tenants, stays and payments are entered by hand.

### Two seed scripts, and only one may point at production

| | `scripts/seed-demo.py` | `scripts/seed-chopra.py` |
|---|---|---|
| Owner | `demo@seed.invalid` (RFC 2606, cannot be real) | a real account |
| Writes | tenants, stays, payments, settlements | **sites, rooms and beds only** |
| Target | localhost | `HOSTEL_API`, defaulting to the Render backend |
| Re-run | `make seed-demo-reset` deletes and reseeds | idempotent — creates only what is missing |

`seed-chopra.py` is narrow on purpose. It never creates a tenant, stay or
payment, and never deletes or updates anything, so the worst case against live
data is an empty room the owner can delete in the UI. It also **logs in before
trying signup** — the inverse of the fallback that once wrote fake tenants into
a real owner's data (see "Incident" in `PROGRESS.md`). A 401 answers "does this
account exist" without guessing.

```bash
make seed-hostel-dry                              # print the plan, write nothing
make seed-hostel HOSTEL_API=http://localhost:8080 # rehearse against local first
make seed-hostel                                  # against production
```

Rehearsing locally first is not optional politeness — it is how the idempotency
and the wrong-password refusal were verified before the script ever touched the
live database.

### Credentials

`.hostel-credentials.env` at the repo root holds `HOSTEL_EMAIL` and
`HOSTEL_PASSWORD`. It is **gitignored, and must stay that way** — the GitHub
repo is public. The environment overrides the file if both are set.

The app has no change-password feature, so rotating that password today means a
direct `UPDATE` against the Neon database with a fresh bcrypt hash. Worth
knowing before you decide the password needs rotating.

### Bed naming

Bunks are named, not typed: `1L`/`1U` are the lower and upper of bunk frame 1,
and a standalone bed is just its position number. There is no `bed_type` column
and there should not be one — `beds` has a single label field, rent lives on the
**stay** rather than the bed (so an upper bunk can already be cheaper), and
nothing in the app would branch on a type. The grid orders beds by name as text,
which sorts lower before upper for free.

The one caveat that buys: keep positions under 10 per room, or `10L` sorts
between `1L` and `1U`. A bed needing a real label gets a short one — Room 5's
balcony bed is `Balcony`, because the grid tile is 96px wide and swaps its
tooltip for the tenant's name once occupied, so a truncated label is one nobody
can read.

---

## Things deliberately not automated yet

- **Migrations** are still run manually from your laptop against the Neon URL.
  When this becomes annoying, we'll wire it into the Render pre-deploy hook.
- **Email** (password reset, verification) is not set up. Skip until you have
  a second user asking for it.
- **Backups.** Neon takes its own snapshots on the free tier. If you want
  an off-site copy, add a daily `pg_dump` cron from your laptop.
