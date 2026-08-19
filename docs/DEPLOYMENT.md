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
| 5 | [Sentry](https://sentry.io) *or* self-hosted [GlitchTip](https://glitchtip.com) | Seeing errors after they happen | A DSN for the Go SDK and one for the Next.js SDK |

**On #5.** Not strictly required to deploy, and the guide works without it —
but it is the difference between "here is the error" and "try to make it happen
again". The code is already shaped for it: every backend 500 goes through one
`serverError` helper and every client-side crash through one `reportError`, so
wiring a DSN in is a small change in two files rather than seventy. Free tiers
are ample at one-owner volume.

Worth a thought before picking: this app stores photographs of government ID.
Stack traces should not contain them, but Sentry is a third party receiving
error data from a service that handles them, and GlitchTip is the
self-hostable equivalent if you would rather that did not leave your
infrastructure. See "Where the logs go" below for what happens with and
without it.

**Not an account, but same category:** decide now whether the R2 bucket is
public. The app serves tenant photos and ID scans by URL; a public bucket means
those URLs are readable by anyone who has them.

---

## 1. Database (Neon) — ~10 min

1. Sign up at https://neon.tech (see the accounts table above).
2. Create a new project. Region: pick the closest one to where you'll deploy the backend.
3. Once created, copy the **connection string** — looks like:
   ```
   postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
   ```
4. From your laptop, run the migrations against the new database:
   ```bash
   migrate -path backend/migrations \
     -database "postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require" \
     up
   ```
5. (Optional) Connect with `psql` to verify tables exist:
   ```bash
   psql "postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require" -c "\dt"
   ```

> **Future migrations:** every time you ship a new schema change, re-run the
> `migrate ... up` command against the Neon URL before deploying the new
> backend binary. Until automation is in place, this is a manual step.

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
   - `FRONTEND_URL` → leave empty for now; you'll fill it in after step 4.
     (Or paste a placeholder like `https://example.com` — we'll update it.)
   - `BASE_URL` → can stay empty when using S3.
   - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` → from step 2.
5. Click "Apply". Render builds and deploys. First build takes ~5 min.
6. Once deployed, Render shows the service URL, e.g. `https://hostel-backend.onrender.com`.
   Hit `/health` in a browser — should return `{"status":"ok"}`.
7. Run the storage smoke test from your laptop (any small image will do):
   ```bash
   STORAGE_BACKEND=s3 \
   S3_ENDPOINT=... S3_BUCKET=... \
   S3_ACCESS_KEY=... S3_SECRET_KEY=... \
   S3_PUBLIC_URL=... \
     cd backend && go run ./cmd/storage-check --file ./some-image.png
   ```
   It should print "OK" and a URL. Open the URL in a browser — if you see the image, R2 is wired correctly.

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
   - You can register a tenant (try uploading an ID proof to test R2 end-to-end).
   - The image URL in the tenant profile should point at `pub-xxx.r2.dev`, not `localhost`.

---

## Troubleshooting

**CORS errors in the browser console.** `FRONTEND_URL` on Render doesn't match the actual Vercel URL exactly (including https/http and trailing slash). Update it and redeploy.

**File uploads succeed but the URL 403s.** The R2 bucket's "Public access" subdomain isn't enabled, or `S3_PUBLIC_URL` doesn't match the `pub-xxx.r2.dev` URL.

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
3. **Error tracking** (at or just after deploy). Account #5 in the table at
   the top. Wire the DSN into the single `serverError` chokepoint on the
   backend and `reportError` on the frontend — both already exist, so it is a
   change in two files rather than seventy. Gives stack traces, grouping, and
   an email when something new breaks.
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
