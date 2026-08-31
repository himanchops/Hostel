# Deployment

Step-by-step guide to deploying the app to a free/cheap public stack.

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
| ~~5~~ | ~~Sentry / GlitchTip~~ — **deferred, Aug 2026** | Seeing errors after they happen | nothing; skipped for this deploy |

### Decisions taken (Aug 2026)

Both of these were open questions in earlier drafts of this doc. They are
settled; the reasoning is here so it does not get re-litigated next session.

**Error tracking: skipped for this deploy.** No account #5, no DSN. The two
chokepoints stay exactly as they are — `serverError` in
`backend/internal/handlers/errors.go` and `reportError` in
`frontend/src/lib/reportError.ts` — so adding it later is still a change in two
files rather than seventy. The consequence to be clear-eyed about is in "Where
the logs go" below: until it is wired, nothing stores or announces an error, and
a frontend crash leaves no trace anywhere reachable.

For the record on the privacy question that made this worth asking: the ID
photographs never enter the error path. The upload handler streams the file
straight to storage and logs only the object key on failure. What *any* tracker
would collect by default is the request URL, the `Authorization` header, and
registration request bodies (name, phone, email) — real PII, and identical for
Sentry and GlitchTip. It is fixed with a `BeforeSend` scrubber, not by choice of
vendor. GlitchTip also speaks the Sentry protocol, so the SDK and the scrubber
are the same code either way; the decision stays reversible.

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
3. **Root Directory:** `frontend`.
4. **Environment Variables:**
   - `NEXT_PUBLIC_API_URL` = the Render backend URL from step 3.6.
5. Click "Deploy". First build takes ~3 min.
6. Once live, Vercel shows the URL, e.g. `https://hostel-xxx.vercel.app`.

---

## 5. Wire frontend ↔ backend — ~5 min

1. Go back to Render → your backend service → **Environment** tab.
2. Update `FRONTEND_URL` to the Vercel URL from step 4.6.
3. Render auto-redeploys.
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

**Short version: errors now have a cause attached, but nothing stores or
announces them.** Worth knowing the shape of it before something breaks at
11pm rather than after.

| Source | Where it lands | Retention | Anyone told? |
|---|---|---|---|
| Backend request lines + panics | Render's log tab (stdout) | short, and rolls off | no |
| Backend 500s | Render's log tab — every one now logs method, route and cause | short, and rolls off | no |
| Frontend crashes in the browser | the user's browser console only | none | no |
| Postgres | Neon's own console | per Neon's plan | no |

Render captures stdout, so `middleware.Logger()` output and any
`c.Logger().Errorf` line is visible in the dashboard. That is a *tail*, not a
search: no grouping, no history worth relying on, and nothing raises a hand
when a 500 happens. If you are not looking at the moment it breaks, it is gone.

The frontend is worse — it is a client-rendered app on Vercel, so a React crash
or a failed fetch happens in someone's browser and leaves no trace anywhere you
can reach.

### The plan, in the order it is worth doing

1. ~~**Stop discarding errors.**~~ ✅ Done. One `serverError` helper logs the
   cause behind every backend 500, and the 19 `db.Get` calls that silently
   dropped their error — turning a database failure into a misleading 404 —
   now check it. This was the step that made everything after it useful.
2. ~~**Add an error boundary.**~~ ✅ Done. `error.tsx` and `global-error.tsx`
   catch client-side crashes, reporting through `lib/reportError.ts`.
3. **Error tracking** — ⏸ **deferred at the Aug 2026 deploy** (see "Decisions
   taken" at the top). When picked up: wire the DSN into the single
   `serverError` chokepoint on the backend and `reportError` on the frontend —
   both already exist, so it is a change in two files rather than seventy.
   Gives stack traces, grouping, and an email when something new breaks. Add a
   `BeforeSend` scrubber in the same change; the default SDK payload carries the
   `Authorization` header and registration request bodies.
4. **Log drain** (optional, later). Render can forward stdout to Better Stack
   or Papertrail for searchable retention. Only worth it once there is enough
   traffic that "tail the dashboard" stops working.

Steps 1 and 2 are ours and cost a session. Step 3 needs an account and a DSN,
so it needs you.

**Rule going forward:** a 500 that reaches a user and leaves no trace is a bug
in its own right, separate from whatever caused it. See CLAUDE.md.

## Things deliberately not automated yet

- **Migrations** are still run manually from your laptop against the Neon URL.
  When this becomes annoying, we'll wire it into the Render pre-deploy hook.
- **Email** (password reset, verification) is not set up. Skip until you have
  a second user asking for it.
- **Backups.** Neon takes its own snapshots on the free tier. If you want
  an off-site copy, add a daily `pg_dump` cron from your laptop.
