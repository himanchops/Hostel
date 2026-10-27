# Build Progress

Tracking phases, what's done, and what's next.

---

## Phase 0 — Project Foundation ✅
_Committed: `a047e85`_

- Go backend scaffold (Echo framework, sqlx, JWT, bcrypt)
- Next.js 16 + React 19 + Tailwind 4 frontend scaffold
- PostgreSQL schema via `001_init.up.sql`
  - Tables: `owners`, `hostel_sites`, `rooms`, `beds`, `tenants`, `stays`, `payments`
  - Enums: `rent_cycle` (daily/weekly/monthly), `payment_type` (cash/online)
- Docker Compose for local Postgres
- Makefile targets: `db-up`, `migrate`, `backend`, `frontend`, `build-backend`
- Auth service stub (JWT + bcrypt), middleware stub, DB connection

---

## Phase 1 — Auth + Sites/Rooms/Beds API + Frontend Auth Flow ✅

**Backend**
- `POST /auth/signup` — create owner account, returns JWT
- `POST /auth/login` — returns JWT
- `GET /api/me` — current owner profile
- Sites CRUD: `GET/POST /api/sites`, `GET/PUT/DELETE /api/sites/:id`
- Rooms CRUD: `GET/POST /api/sites/:siteId/rooms`, `PUT/DELETE …/:id`
- Beds CRUD: `GET/POST /api/sites/:siteId/rooms/:roomId/beds`, `PUT/DELETE …/:id`
- All queries scoped to `owner_id` for multi-tenant isolation
- CORS locked to `FRONTEND_URL` env var

**Frontend**
- `src/lib/api.ts` — typed fetch wrapper, `ApiError`, all endpoint functions
- `src/contexts/auth.tsx` — `AuthContext` with JWT persisted in localStorage, session restore on mount
- `/login`, `/signup` — clean auth forms with error handling
- `/(auth)/layout.tsx` — centered layout, redirects to dashboard if already logged in
- `/(dashboard)/layout.tsx` — sidebar nav (Dashboard, Sites), auth guard, owner info + logout
- `/dashboard` — summary cards + sites list preview
- `/sites` — full sites CRUD (create, list, delete)
- `/sites/[id]` — rooms list with expandable bed management (add/remove inline)
- Root `/` — redirects to dashboard or login based on auth state

---

## Phase 2 — Room Grid + Tenant/Stay/Payment Management ✅

**Backend**
- `GET /api/sites/:siteId/grid` — core grid endpoint; single SQL query joins rooms → beds → active stays → tenants → payments, computes bed status server-side
- Bed status logic:
  - `vacant` — no active stay
  - `paid` (green) — balance ≥ 0
  - `partial` (yellow) — owes less than one full rent cycle
  - `overdue` (red) — owes ≥ one full rent cycle
  - `vacating_soon` (orange) — notice given or end_date within 30 days
- Billing cycle calculation handles monthly/weekly/daily, anchored to `start_date`
- Tenant CRUD: `GET/POST /api/tenants`, `GET/PUT /api/tenants/:id`
- Stay management: `POST /api/stays`, `GET/PUT /api/stays/:id`, `GET /api/tenants/:id/stays`
- Payment ledger: `GET/POST /api/stays/:stayId/payments`, `DELETE /api/payments/:id`

**Frontend**
- `/sites/[id]/grid` — occupancy grid with color-coded bed cards
  - Status legend with all 5 states
  - Click vacant bed → side panel: search existing tenants or create new, set rent/deposit/cycle/start date, assign
  - Click occupied bed → side panel: balance display (paid vs expected), payment history, add payment form, one-click vacate
  - Grid refreshes after any mutation
- `/tenants` — searchable tenant list with inline create form
- `/tenants/[id]` — full tenant profile: all stays (active + historical), expandable payment ledger per stay, add payment inline, end stay
- Sidebar updated with Tenants nav item
- `formatCurrency()` helper for paise → ₹ display

---

## Phase 3 — Tenant Self-Registration + Tenant Portal ✅

_Committed: `8481bb4`_

**Backend**
- `POST /public/register/:ownerId` — public self-registration with name/phone/email/password
- `POST /tenant-auth/login` — tenant login (phone + password)
- Tenant JWT middleware (separate from owner JWT)
- `GET /tenant/me`, `GET /tenant/stays`, `POST /tenant/stays/:id/payments`, `PUT /tenant/stays/:id/notice`
- `POST /tenants/:id/approve` — assign bed/rent/cycle/start, auto-creates stay
- `DELETE /tenants/:id/reject` — reject pending registration
- `GET /payments/pending`, `POST /payments/:id/approve` — owner review of tenant-submitted payments
- Migration `002_tenant_auth` — adds `password_hash` to tenants table

**Frontend**
- `/register/[ownerId]` — public registration form (no auth required)
- `/my/login`, `/my` — tenant portal: view ledger, submit payments, give notice
- `/pending` — owner review page: Registrations tab + Payment Proofs tab
- Tenant auth context (separate from owner auth)

---

## Phase 4 — Dashboard Insights ✅

**Backend**
- `GET /api/dashboard` — single endpoint returning: per-site occupancy, revenue summary (expected/collected this month, overdue total), alert counts (pending registrations + payments), vacating-soon list, recent payments feed
- `cyclesElapsed` extracted to `handlers/helpers.go` (shared between grid and dashboard)

**Frontend**
- Dashboard page fully rewritten: alert banners, 4 stat cards, vacating-soon + recent-payments panels, per-site occupancy bars

---

## Phase 5 — File Uploads (ID Proofs + Payment Screenshots) ✅

**Backend**
- `StorageService` interface at `internal/storage/` — swappable local vs S3
- `LocalStorage` impl: saves files to `./uploads/`, served at `/uploads/*`
- `POST /public/upload` — no auth, used by tenant registration (images + PDF, max 10 MB)
- `POST /tenant/upload` — tenant JWT, used by payment proof uploads
- `POST /public/register/:ownerId` now accepts `id_proof_url`
- `POST /tenant/stays/:stayId/payments` now accepts `proof_url`
- `BASE_URL` env var (default `http://localhost:8080`) controls file URL prefix

**Frontend**
- Registration form: optional ID proof file picker — uploads first, then includes URL in registration call
- Tenant portal payment form: optional screenshot file picker — same two-step pattern
- `/pending` page: "View ID proof →" link on registrations, "View screenshot →" link on payment submissions

**For production**: swap `LocalStorage` for S3/R2 implementation — set `BASE_URL` + S3 env vars

---

## Phase 6 — E2E Testing ✅

- Playwright config with custom failure reporter → `test-results/failures.json`
- `make test-e2e`, `make test-e2e-ui`, `make test-e2e-debug`, `make fix-tests` targets
- `scripts/fix-tests.ts` — categorizes failures (api-error, navigation, missing-element, etc.) → `test-results/fix-report.md`
- `tests/e2e/helpers/api.ts` — typed API helpers for seeding test data
- `tests/e2e/owner/tenant-management.test.ts` — tenant creation API + UI; caught + fixed NULL scan bug in models
- **Convention**: new features get a Playwright test alongside the implementation

**Remaining test coverage** (to be added per feature):
- `owner/auth.test.ts` — signup, duplicate email, login, logout
- `owner/site-setup.test.ts` — site/room/bed CRUD, grid shows vacant
- `owner/tenant-review.test.ts` — pending registration, approve, reject
- `owner/payments.test.ts` — direct payment, approve proof, reject proof
- `owner/dashboard.test.ts` — stat cards after seeded data
- `tenant/registration.test.ts` — public form → success screen
- `tenant/portal.test.ts` — portal view, submit payment, give notice

---

## Phase 7 — Tenant Profile Enrichment + Registration UX ✅

**DB**
- Migration `003_tenant_profile` — 7 new columns on `tenants` (address, emergency contact name/phone, workplace, aadhaar_number, id_proof_front_url, id_proof_back_url); `stays.bed_id` made nullable (pending bed assignment)
- Partial index `idx_stays_active_tenant` for one-active-stay enforcement

**Backend**
- `Tenant` model: 7 new `*string` fields
- `Stay.BedID`: `int64` → `*int64` (null = deposit collected, bed TBD)
- All 6 tenant query sites updated to include new columns
- `Approve` handler: 3-path approval — approve only / assign bed / collect deposit without bed
- One-active-stay guard on `Approve` and `Stay.Create` (409 if active stay exists)
- `AssignBed` handler: `PUT /api/stays/:id/assign-bed`
- `Summary` handler: `GET /api/tenants/:id/summary` — aggregate totals (total_paid, total_expected, balance, duration_days)
- `tenant_portal.go`, `dashboard.go`, `payments.go`, `grid.go`: LEFT JOINs + COALESCE throughout for nullable `bed_id`

**Frontend**
- Self-registration form: address, workplace, emergency contact, Aadhaar, ID front + back
- Pending page — registration cards: circular avatar (photo or initials, deterministic color), click card body → **profile side drawer** with full details + ID proof tiles + Approve/Reject
- Pending page — approval modal: 3-mode radio (approve only / assign bed / collect deposit)
- Tenant detail page:
  - Profile card (all new fields, masked Aadhaar, ID proof links) + "Edit profile" inline form with file uploads
  - Financial summary bar (total paid / duration / balance, color-coded)
  - End-stay **date picker** (replaces `confirm()` + hard-coded today)
  - Unassigned stay: amber "Bed unassigned" badge + "Assign bed" → modal with vacant bed picker
- `maskAadhaar()` helper: `XXXX-XXXX-1234`

**Tests**
- `tests/e2e/owner/tenant-profile-enrichment.test.ts` — 8 tests: public registration with profile fields, deposit-only approval, assign-bed, one-active-stay enforcement, summary endpoint, profile update, UI profile card, UI end-stay date picker

---

## Phase 8 — Tenant UX Polish ✅

### 8a — Unified review + approve drawer
- Merged the old two-step flow (ProfileDrawer → ApproveModal) into a single `ReviewDrawer` component
- Step 1 ("review"): profile details, ID proof tiles, Reject/Approve buttons
- Step 2 ("approve"): back arrow, 3-mode radio (approve only / assign bed / collect deposit), rent fields inline
- Single drawer, no more overlapping modal layers
- Removed `approvingTenant` state — only `drawerTenant` needed now

### 8b — Full-page Add Tenant form
- New page at `/tenants/new` with full profile form (3 sections: basic info, profile details, documents)
- All fields: name, phone, email, address, workplace, emergency contact, Aadhaar, photo/ID front/ID back
- On create → redirect to `/tenants/:id` detail page
- `tenantsApi.create` now accepts full `TenantUpdateData` (backend already supported all fields)
- `/tenants` list page: replaced inline 3-field form with link to `/tenants/new`
- Updated existing e2e tests for the new form flow

---

## Phase 9 — Deployment

Target stack: **Render** (backend) + **Neon** (Postgres) + **Cloudflare R2** (files) + **Vercel** (frontend). $0/mo on free tiers, ~$7/mo to keep backend always-on. Full walkthrough in `docs/DEPLOYMENT.md`.

### Phase 9.1 — Code prep ✅ (on `phase-9-deploy-prep` branch)

- `backend/internal/storage/s3.go` — `S3Storage` impl using `aws-sdk-go-v2`; works with R2, AWS S3, or MinIO (path-style addressing). Builds public URLs from `S3_PUBLIC_URL` so no signed-URL handshake on read.
- `backend/internal/storage/selector.go` — `NewFromEnv()` chooses `S3Storage` vs `LocalStorage` based on `STORAGE_BACKEND`. Unknown values fall back to local rather than disabling uploads silently.
- `backend/internal/storage/selector_test.go` — 4 unit tests covering selector behavior + S3 cred validation.
- `backend/internal/database/database.go` — new `ConnectURL(dsn)` accepts the `postgres://...` DSN that Neon/Render/Supabase hand out.
- `backend/cmd/server/main.go` — uses `DATABASE_URL` when set, falls back to per-field `DB_*` vars for local; uses `storage.NewFromEnv` instead of always-local.
- `backend/cmd/storage-check/main.go` — smoke-test CLI: uploads a single file through the configured backend, prints the public URL. Catches R2 config bugs without needing the full app.
- `render.yaml` — Blueprint defining the backend service, env-var schema, health-check path, and which secrets the user fills in.
- `backend/.env.example` — full env-var inventory with REQUIRED vs LOCAL ONLY markers.
- `docs/DEPLOYMENT.md` — step-by-step deploy walkthrough (Neon → R2 → Render → Vercel).
- `Makefile` — new `storage-check` target.

**Local dev unchanged:** without `STORAGE_BACKEND` set, the server picks `LocalStorage`; without `DATABASE_URL`, it uses the `DB_*` vars. Existing `make dev` flow works identically.

**New backend deps:** `github.com/aws/aws-sdk-go-v2`, `.../config`, `.../credentials`, `.../service/s3`. Will be pulled in by `go mod tidy`.

### Phase 9.2 prep — decisions + upload rate limiting ✅ (deploy session, Aug 2026)

Two questions that had been left open in `docs/DEPLOYMENT.md` were settled
before touching any dashboard. Both are written up in full there under
"Decisions taken"; the short version:

- **Error tracking: skipped.** No Sentry/GlitchTip account for this deploy. The
  `serverError` / `reportError` chokepoints are untouched, so it stays a
  two-file change later. Consequence accepted: nothing stores or announces an
  error yet.
- **R2 bucket: public.** Keys are `public/<32 hex>.ext` from `crypto/rand` and
  r2.dev does not list directories, so it is unguessable-link, not browsable.

The second decision made `POST /public/upload` — unauthenticated by necessity,
since a stranger uploads ID before any account exists — an open file host on the
Cloudflare account. Fixed in this session:

- `backend/internal/middleware/ratelimit.go` — `PublicUploadRateLimiter()`,
  per-client-IP token bucket. Burst 10, refill one per three minutes, idle IPs
  forgotten after an hour. Sized from the legitimate worst case: one
  registration is three files, and a whole hostel can share one NAT'd IP.
  Denies return the API's `{"error": ...}` envelope, not Echo's
  `{"message": ...}`, because `lib/api.ts` reads `body.error` and would
  otherwise show a generic "Upload failed".
- `backend/cmd/server/main.go` — `e.IPExtractor = echo.ExtractIPFromXFFHeader()`.
  Without it, Echo's fallback reads the *first* `X-Forwarded-For` entry, which
  the client writes and can forge — enough to walk past the limiter by rotating
  a header. Verified against a running binary: 12 requests with rotating forged
  XFF values all resolved to the proxy-observed client and were limited at the
  11th. This also fixes `remote_ip` in the request log, which behind Render
  would otherwise have been the proxy on every line.
- `backend/internal/middleware/ratelimit_test.go` — 3 tests: burst allowed,
  denial past it with the right envelope, buckets independent per client.

**Deliberately not logged in the DenyHandler.** `middleware.Logger()` already
records the 429 with the resolved `remote_ip`. A `c.Logger().Warnf` was written
and then removed — Echo's default logger level is ERROR, so it emitted nothing
while reading as though it did, which is the swallowed-error pattern CLAUDE.md
forbids wearing a disguise.

Not covered by e2e: no test in `frontend/tests/e2e/` touches file upload at all,
so the limiter cannot regress the 34-test suite — and uploads have no e2e
coverage to begin with. Noted rather than fixed here.

Follow-ups in `docs/BACKLOG.md` → "Security / privacy": presigned URLs (grows
more expensive per real tenant row, because the DB stores absolute URLs rather
than keys) and a registration token gating the upload.

### Phase 9.2 — Database (Neon) ✅ (Aug 2026)

Project on AWS `ap-southeast-1` (Singapore). Neon offers no India region — its
list stops at Singapore for APAC — and the backend is pinned to Render's
`singapore` anyway. Co-locating DB with compute is what matters: user→backend is
one round trip per page, backend→DB is several.

Neon Auth, Object storage, Functions and the AI gateway were all left off. Neon
Auth in particular would have added its own tables and broken the "exactly nine
tables" verification below.

Verified, not assumed: 5 migrations applied, `migrate ... version` → `5` clean,
and `pg_tables` returns exactly the nine expected names. Then the real server
binary was run locally against the Neon URL and a signup round-tripped, which is
what actually proves the driver and pooler work — `/health` only proves the
process booted.

**The connection string is the pooled endpoint** (`...-pooler...`, PgBouncer in
transaction mode). Checked that nothing in the app depends on session state:
no `LISTEN`/`NOTIFY`, no advisory locks, no temp tables, no `SET SESSION`. The
one explicit transaction (`settlements.go:336`) is fine — a transaction is the
unit PgBouncer pools by. Driver is `lib/pq` via sqlx and it accepts
`channel_binding=require`.

### Makefile: `make migrate` could target the wrong database ✅ (Aug 2026)

Found while cleaning up the smoke-test row. `make migrate`, `make migrate-down`
and `make seed-demo-reset` were hardcoded to `localhost:5432`. Harmless with one
database; a real trap with two, because a deploy-time `make migrate` would
report success having migrated local, and the missing column would surface as a
production 500 — precisely the failure DEPLOYMENT.md warns is easy to forget.

- `LOCAL_DB` and `DATABASE_URL ?= $(LOCAL_DB)` at the top of the Makefile.
- `migrate` / `migrate-down` honour the override, echo `LOCAL` or `REMOTE`
  before running, and `migrate` prints the resulting version afterwards.
- `seed-demo-reset` is deliberately **not** overridable and now announces that
  it is local-only. It writes rows; a typo in a remote URL is not a mistake
  worth making cheap — same reasoning as the `demo@seed.invalid` convention.

Deploy usage: `make migrate DATABASE_URL="$NEON_URL"`.

### Phase 9.3 — File storage (Cloudflare R2) ✅ (Aug 2026)

Bucket `hostel-uploads`, location Asia-Pacific, Standard storage class.
Infrequent Access was rejected deliberately: it bills per retrieval and imposes
a 30-day minimum per object, and tenant photos are fetched every time an owner
opens a profile — IA would charge for the app working normally.

> **Superseded (Sep 2026):** the bucket is private now, and reads use
> presigned links from the S3 endpoint. See "Pre-import hardening". The
> reasoning below was right for a public bucket.

Public read is served by the **R2.dev development subdomain**, because the app
needs two hostnames for two jobs: the S3 API endpoint takes SigV4-signed writes
from the Go backend, and an `<img src>` in the browser cannot sign anything. The
code already enforces the split — `NewS3Storage` refuses to start with an empty
`PublicURL`. Cloudflare labels it "Public Development URL" and rate-limits it;
a custom domain is the eventual answer and is noted in BACKLOG.md.

API token: `Object Read & Write` — the least privilege that permits `PutObject`,
since reads never touch the API — scoped to `hostel-uploads` alone, no IP
filter (Render's free tier has no stable outbound IPs, so a filter would work
once and then break on redeploy).

Verified with `cmd/storage-check`: `Backend: *storage.S3Storage`, upload
succeeded, and the returned URL rendered in a private window.

No CORS policy on the bucket, and none needed: browsers do not apply CORS to
`<img>` display, and uploads go browser → backend → R2, never browser → R2.

Gotchas worth keeping, both of which cost real time to spot:
- `S3_ENDPOINT` is the **host only**. The dashboard shows it with the bucket
  path appended; leaving that on produces `.../hostel-uploads/hostel-uploads/...`
  because the SDK uses path-style addressing.
- The token result screen shows a prominent **"Token value"** that is for
  Cloudflare's own API, not S3. The needed pair is Access Key ID / Secret Access
  Key further down; using the token value gives a signature error that reads
  like a typo.

### Phase 9.4–9.6 — Render, Vercel, wiring ✅ (Aug 2026) — **the app is live**

- Backend: `https://hostel-backend-k7ar.onrender.com` (Render, free, singapore)
- Frontend: `https://hostel-ten-kappa.vercel.app` (Vercel, hobby)

**Render** came up via Blueprint off `render.yaml`, so the twelve service
settings and non-secret env vars were read from the file and only the eight
`sync: false` secrets were typed. `GO_VERSION` was pinned in `render.yaml` first
(PR #22) because `backend/go.mod` needs 1.25.7, Render's default lags, and the
resulting failure reads like a dependency problem.

**Vercel** auto-detected the monorepo and proposed deploying the Go backend as
`/api/backend` alongside the frontend, asking for a `vercel.json` to formalise
it. Declined: Echo is a long-lived server, not a request-scoped function, and a
half-working unconfigured second copy of an app that handles government ID is
worse than one that plainly fails. Setting **Root Directory = `frontend`**
collapses the detection to a single Next.js service.

`NEXT_PUBLIC_API_URL` is set for Production **and** Preview, so branch previews
point at the production backend and get CORS-refused. That is the safer of two
broken options — do **not** add a preview origin to `FRONTEND_URL` to "fix" it,
because that lets a branch deploy write to production Neon.

**Verified end to end against the deployed stack, not the dashboards:**

| Path | Check |
|---|---|
| Browser → Vercel | 200; `hostel-backend-k7ar.onrender.com` found in the shipped JS chunks and `localhost:8080` absent — proves the build-time inline took |
| Browser → Render | preflight from the real origin returns ACAO; `placeholder.invalid` and the trailing-slash variant both refused |
| Render → Neon (read) | login as unknown user → 401, not 500 |
| Render → Neon (write) | signup → 201, read-back login → 200 |
| Render → R2 | upload returned a `pub-*.r2.dev` URL |
| Browser → R2 | 200, `image/png`, exact byte count |

The CORS trailing-slash check is worth keeping in the routine: `FRONTEND_URL`
with a trailing slash produces a configuration that looks complete and refuses
every request, and the only symptom is a browser-console error.

**Left behind by verification:** two objects in R2 (`smoke-test/` and
`public/`, ~137 bytes each) and one `demo@seed.invalid` owner row, deleted
after the fact with
`psql "$NEON_URL" -c "DELETE FROM owners WHERE email = 'demo@seed.invalid';"`.

**Phase 9 is complete.** Remaining loose ends are in `docs/BACKLOG.md`, not here:
no error tracking (deferred by decision), no e2e coverage on file upload,
`/auth/login` and `/public/register` still unthrottled, presigned URLs, a custom
domain on the bucket, and the Aadhaar questions.

Steps live in `docs/DEPLOYMENT.md`:
- 9.2 Database (Neon) — create project, run migrations against the `DATABASE_URL`
- 9.3 File storage (Cloudflare R2) — bucket + public subdomain + API token
- 9.4 Backend (Render) — Blueprint pick-up via `render.yaml`, fill in secrets, hit `/health`
- 9.5 Frontend (Vercel) — point at `frontend/`, set `NEXT_PUBLIC_API_URL`
- 9.6 Wire `FRONTEND_URL` back into Render, verify end-to-end with a real signup + upload

---

## Roadmap decision (Apr 2026)

Owner is the alpha user, running locally. Decision: ship the **UI modernization**
(`docs/DESIGN_PLAN.md`, Phases A–E) and the two **value features below** BEFORE
deploying. Recommended execution order:

1. Design Phase A (foundations) + Phase B (component kit) — B blocks everything ✅
2. **Phase 10 — Collections & WhatsApp nudges** (built WITH the new component kit, not before it) ✅
3. Design Phase C (mobile shell) — nudges are used from a phone, so mobile matters here ✅
4. Design Phase D (hero screens) ✅ + E (feedback layer) ✅
5. **Phase 11 — Settlement calculator** ✅
6. Design Phase F (public surfaces) — the registration page a stranger sees;
   worth doing before real tenants are pointed at it by QR code ✅
7. Phase 9.2–9.6 — deploy

---

## Phase 10 — Collections & WhatsApp Nudges ✅

**Shipped:** `GET /api/collections` + `/collections`, built on the Phase B kit.
The dashboard's overdue *total* is now a *worklist*: who owes, how long, one tap
to chase, one tap to record the money.

Decisions and details worth knowing:

- **Sign convention.** `balance_paise` is what the tenant OWES, so it is
  positive, and rows with nothing outstanding never reach the client. That is
  the opposite sign from the grid's balance (`paid − expected`) and the same as
  the tenant summary's. Documented on both the Go struct and the TS interface,
  because three conventions in one codebase is already one too many.
- **"Days overdue" counts from the first *unpaid* cycle**, not the current one.
  A tenant three cycles behind has been overdue since the oldest one, and that
  is the number that belongs in the nudge. Whole cycles paid = `totalPaid /
  rentAmount`, so a part payment reduces the balance without resetting the
  clock — there is a test pinning exactly that.
- **New helper `cycleStart(start, n, cycle)`** in `collections.go` — the
  inverse of `cyclesElapsed`, with the same month-end clamping. A test walks
  one against the other for 14 cycles across mid-month, month-end, 30th and
  leap-year move-ins; if they ever disagree, "days overdue" would drift from
  the balance sitting next to it on the page.
- **Phone normalisation is stricter than the plan said.** The plan said "if the
  result isn't 12 digits, hide the button"; a bare length check lets
  `098123456012` through, which is nobody's number. `normalizePhone` accepts
  only 10 digits (prefixed `91`) or 12 digits already starting `91`. The cost
  is that a genuine non-Indian number can't be nudged — acceptable while the
  app is rupee-denominated, and the 10-digit branch already assumed India.
- **Toast is now wired**, but only for this page's payment mutation. The
  sweep across every other mutation is still design Phase E.

**Known discrepancy (not fixed here):** collections includes stays with no bed
assigned, per this phase's spec, but the dashboard's `overdue_amount` excludes
them (`s.bed_id IS NOT NULL`). So the two figures can disagree for an owner who
has collected a deposit without allocating a room. Worth reconciling — probably
by dropping the dashboard's filter — but that changes a tested money figure, so
it wants its own change rather than riding along here.

**Mobile:** the page itself is fine at 375px (cards stack, actions wrap, no
horizontal scroll). The 224px fixed sidebar is what makes the viewport unusable,
which is exactly what design Phase C converts to a bottom tab bar.

Tests: `collections_test.go` (balance, overdue age, part payments, weekly/daily
cycles, exclusions, sorting, nullable passthrough, the cycleStart↔cyclesElapsed
inverse), `tests/unit/wa-link.test.ts` (normalisation, encoding, the message
template verbatim), and `tests/e2e/owner/collections.test.ts` (API row math,
paid-up tenant absent, record-payment-clears-the-row, bad phone offers a fix).

### Original spec

**Backend**
- `GET /api/collections` — one query over active stays (`end_date IS NULL`) with
  computed balance > 0. Reuse `cyclesElapsed` from `handlers/helpers.go` (same
  logic as grid/dashboard). Returns per row:
  `tenant_id, tenant_name, phone, site_name, room_name, bed_name (nullable),
  rent_amount, balance_paise, days_since_due, last_payment_date (nullable),
  stay_id, rent_cycle`.
  Sorted by `balance_paise` DESC. Owner-scoped like everything else.

**Frontend**
- New page `/collections` + sidebar/tab nav item ("Collections", with count badge
  of rows, red when > 0).
- Each row: tenant name + room/bed, balance (red, `tabular-nums`), days overdue,
  last payment date, and two actions:
  1. **Record payment** — inline expand (not a page nav): amount prefilled with
     the balance, type cash/online, date defaulting to today. Posts to the
     existing `POST /api/stays/:stayId/payments`. Row disappears (or balance
     updates) on success + toast.
  2. **WhatsApp nudge** — `https://wa.me/<phone>?text=<encoded message>`
     opened in a new tab. NO WhatsApp API, NO backend involvement — it's a deep
     link that opens WhatsApp with the message prefilled; the owner presses send.
- Phone normalization for wa.me: strip non-digits; if 10 digits, prefix `91`
  (India). If the result isn't 12 digits, hide the nudge button and show a
  "fix phone" link to the tenant edit page instead. Helper `waLink(phone, msg)`
  in `lib/` with unit-testable pure logic.
- Default message template (hardcoded v1, editable textarea inline before send
  is a nice-to-have, not required):
  `"Hi <first name>, this is a reminder that rent of <₹amount> for <room> is
  pending (due <n> days ago). Please pay at your convenience. Thank you!"`
  Amount formatted via `formatCurrency`.
- Empty state: "Everyone is paid up 🎉" (EmptyState component).

**Tests**
- e2e: seed a stay with an old start_date and no payments → row appears on
  /collections with correct balance → record payment inline → row clears.
- Unit test `waLink()`: 10-digit, +91-prefixed, garbage, and short numbers.

**Explicitly out of scope:** automated/scheduled sending, WhatsApp Business API,
SMS, email. The owner taps; the app never messages anyone by itself.

---

## Phase 11 — Settlement Calculator ✅

**Shipped:** migration `005_settlements`, three endpoints, and a Settle & vacate
drawer on the tenant page. The hand calculator is gone: deposit held − rent
outstanding ± manual adjustments = what changes hands, computed live as the
owner types and re-checked by the server before anything is written.

Decisions and details worth knowing:

- **Migration is `005`, not `004`.** The plan was written before
  `004_drop_rent_due_day` landed.
- **`deposit_paise` and `dues_paise` are snapshots**, not views onto the stay.
  S1 made rent and start date editable, and a settlement records money that
  actually changed hands — correcting a stay afterwards must not silently
  rewrite what was handed over.
- **What happens to a rent advance is the owner's decision, not the formula's.**
  A tenant who paid three months up front and left after two has an advance
  sitting there, and the settlement offers *return all of it / return part of it
  / do not return it*. The chosen amount is stored in
  `advance_returned_paise` — a decision, not a derivation, so a settlement row
  can be told apart from one where no advance existed.

  The first cut let this fall out of a signed `dues` (`deposit − dues`), which
  handed the whole advance back automatically. That is a policy, and not one
  this app gets to set: "partial" in particular cannot be derived from anything.
  `refundFor` now takes the returned amount as an explicit term, and
  `validateAdvanceReturned` keeps it inside what exists — no negatives, no more
  than was paid, and nothing at all when the tenant owes rent.

  **Returning it in full stays the default**, so an owner who never touches the
  control gets the generous reading and nothing changed silently. If the same
  option gets picked every time, an account-level default can sit on top of
  this later; it would need this control underneath it either way.
- **The server recomputes and rejects a mismatch.** Not because the client is
  hostile but because the drawer goes stale: a payment recorded in another tab
  moves the dues, and the owner would otherwise hand over a refund based on
  numbers that are no longer true. The 400 says so and tells them to reopen it.
- **The owner never types a minus sign.** Each adjustment row is a
  Deduct/Add-back choice plus a positive amount; the sign is applied for them.
  `parseRupees` rejects a typed minus so the two cannot cancel out, and accepts
  commas — `parseFloat("1,200")` is `1`, which would turn a ₹1,200 deduction
  into ₹1 with nothing on screen to show for it.
- **An already-ended stay settles against its own end date.** A request naming
  a different one is refused, not ignored — the settlement and the ledger have
  to describe the same move-out. Reachable from the UI too ("Settle deposit" on
  an ended, unsettled stay), because ending from the grid is a normal thing to
  do first.
- **A settlement does not write off the rent ledger.** The tenant summary still
  shows the outstanding rent afterwards; the settlement records what was paid
  out, which is a different question. Pinned by a test.
- **`GET /api/tenants/:id/settlements` replaces the planned
  `GET /api/stays/:id/settlement`.** The tenant page badges every ended stay, so
  the per-stay version would be N requests to render N badges — and with the
  list endpoint in place nothing would have called it.
- **The drawer shows its working** (`4 months × ₹8,500 = ₹34,000 billed ·
  ₹25,500 paid`). The one number the owner will argue with is the outstanding
  rent, and a bare total gives them nothing to check it against.

**Bug found and fixed on the way:** `GET /api/stays/:id` had *always* returned
404. `stayCols` is unqualified and that handler joins `tenants` to scope by
owner, so `id` is ambiguous and Postgres refused the query. Nothing in the app
calls the endpoint, so it went unnoticed. Now uses `stayColsQualified`. Worth
noting that the settlement test's first draft asserted `end_date` was falsy —
which passes on an error body too; asserting the status first is what exposed
it.

**Also fixed:** a stay card showed "Paid ₹0" until expanded, because payments
load lazily. Harmless before; a false zero sitting next to a refund figure is
not. Now shows "Paid —" until it knows.

Tests: `settlements_test.go` (23 — dues across monthly/weekly/daily and
month-end clamping, the move-out date changing the bill by exactly one cycle,
paid-ahead, refunds going negative, the stale-preview mismatch, agreement with
the tenant summary, date resolution, adjustment validation; three mutants killed
the advance returning in full/part/none and its validation; six mutants killed
on the arithmetic), `tests/unit/settlement.test.ts` (16 — the same fixture as
the Go tests so the two implementations cannot drift, plus rupee parsing and
cycle labels), and `tests/e2e/owner/settlement.test.ts` (7 — preview working and
exact stored refund, double-settle 409, mismatch 400, unlabelled adjustment 400,
already-ended path, all three advance outcomes plus both advance rejections, and
the full UI flow with a comma-typed deduction).

### Original spec

When a tenant vacates: deposit held − outstanding dues ± manual adjustments =
refund. Currently done on a hand calculator; money mistakes happen there.

**DB**
- Migration `004_settlements`:
  ```sql
  CREATE TABLE settlements (
      id BIGSERIAL PRIMARY KEY,
      stay_id BIGINT NOT NULL UNIQUE REFERENCES stays(id) ON DELETE CASCADE,
      deposit_paise BIGINT NOT NULL,
      dues_paise BIGINT NOT NULL,          -- outstanding rent at settlement time (snapshot)
      adjustments JSONB NOT NULL DEFAULT '[]', -- [{"label": "Damaged chair", "amount_paise": -50000}, ...]
      refund_paise BIGINT NOT NULL,         -- final: deposit - dues + sum(adjustments); negative = tenant owes
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
  Adjustments sign convention: negative = deduction from refund (damage, unpaid
  electricity), positive = credit to tenant (e.g. advance rent returned).

**Backend**
- `GET /api/stays/:id/settlement-preview` — computes deposit, current outstanding
  dues (reuse cycle logic), returns them; frontend does live math as the owner
  adds adjustment lines.
- `POST /api/stays/:id/settlement` — body: adjustments array + notes + final
  refund_paise (server recomputes and validates: refund must equal
  deposit − dues + Σ adjustments; 400 on mismatch). Creates the settlement row
  AND sets `stays.end_date` if not already set (settling implies vacating —
  accept an `end_date` in the body, default today).
- `GET /api/stays/:id/settlement` — fetch existing (for display on tenant page).
- Owner-scoping via the stay → tenant → owner chain, as everywhere.

**Frontend**
- Tenant detail page: when a stay has `notice_date` set OR the owner clicks
  "End stay", show **Settle & vacate** flow (Drawer):
  - Read-only lines: Deposit held, Outstanding dues (fetched from preview)
  - **Manual adjustment rows: label + amount, add/remove freely** (the owner
    must be able to override reality — damaged property, verbal agreements,
    goodwill discounts)
  - Live-computed refund line, color-coded (emerald = pay tenant,
    red = tenant owes)
  - Notes field, confirm button → posts settlement, ends stay, toast
- After settlement: stay card shows a "Settled" badge + refund amount;
  settlement details expandable.
- The old plain end-stay date picker remains available as "End without
  settlement" (skips the money part) — not every vacate needs the ceremony.

**Tests**
- e2e: tenant with deposit + partial payments → settle with one deduction →
  correct refund shown and stored → stay ended → summary endpoint reflects it.
- Backend validation test: mismatched refund_paise → 400.

---

## Design Phase F — Public surfaces ✅

**Shipped:** `/register/[ownerId]` and `/my/login` converted to the kit, then
the registration page given the one decorative frame in the product. Full
write-up in `docs/DESIGN_PLAN.md`; the parts that matter here:

- **New endpoint `GET /public/owners/:ownerId`** — name only, unauthenticated.
  The registration page could not say which property it belonged to, which is
  the entire trust question for someone who reached it by scanning a sticker.
  Owner ids are enumerable, so the e2e pins the exact response key set to stop
  contact details ever being added to it.
- **`grep -rn "ring-stone-200" src/app` → 0.** That was Phase B's acceptance
  test and it has been outstanding since. Finishing it meant kit-converting the
  tenant shell header and the portal's stay card, and turning the dashboard
  account menu into a `Card` (an overlay, so it keeps `shadow-xl` — Card sets no
  shadow of its own, so there is no class collision).
- **Three `grid-cols-2` blocks were broken at 375px** and now stack below 640px.
- Two raw `ring-1` classes remain, both on the pending page's registration-link
  panel — a tinted multi-line block with no kit equivalent. Documented, not
  forced into `Banner`.

Tests: `tests/e2e/public/registration.test.ts` (3, whole file at 375px — the
name-only endpoint and its 404, a full end-to-end registration reaching the
owner's pending queue with zero horizontal overflow, and the degraded path
where the owner name fails to load).

---

## Phase 13 — Intake documents & tenant photo 🔜

Today the app collects ID proof only if the tenant uploads it themselves during
registration, and every field is optional. In practice the owner photographs
the person and their ID at the door on the day they move in, and that is the
copy that actually exists. The app has nowhere to put it.

**What is missing**
- **A photo taken at intake.** `tenants.photo_url` exists and the owner's edit
  form can upload one, but only as a file picked from disk. On a phone this
  should open the camera — `<input type="file" accept="image/*" capture="user">`
  — because the owner is standing in front of the person.
- **ID documents captured owner-side.** `id_proof_front_url` / `_back_url` are
  filled at registration or not at all. The owner needs to add or replace them
  later, from the tenant page, with the same camera affordance.
- **A view of what is actually on file.** Nothing on the tenant page or the
  pending queue says "no ID on record". An owner cannot see the gap, so the gap
  persists until they need the document and it is not there.
- **More than two slots.** Front and back of one ID is an assumption. Some
  tenants hand over a passport plus a college letter.

**Deliberately not decided here:** whether an ID is *required* before approval.
That is a policy, and per the settlement lesson the app should not freeze one —
surface the gap loudly at approval time and let the owner proceed anyway.

**Storage:** goes through the existing R2/S3 path and `ValidateUploadedURL`, so
this phase depends on 9.3 being done and is best built against real object
storage rather than the local disk backend.

**Privacy note worth carrying:** this turns the app into a store of
government-ID photographs for real people. Access is already owner-scoped, but
the retention question — what happens to these when a tenant leaves — has never
been asked and should be, in this phase.

---

## Incident — seed script wrote into a live account (2026-08-19)

A throwaway script written to populate a demo dataset guessed
`demo@hostel.local` for its owner. That was the actual owner's login. Signup
returned a conflict, and the script's `except: log in instead` fallback treated
that identically to a re-run, so it appended two sites, ten fake tenants, nine
stays and twenty-eight payments to real data. Cleaned up the same session —
everything it wrote was scoped to one owner, one day and one phone prefix, so
the delete was precise and the account returned to its exact prior state.

**Two causes, both worth remembering:**
- A "demo" identifier plausible enough to belong to someone. Seed data now uses
  `demo@seed.invalid`; `.invalid` is reserved by RFC 2606 and can never be a
  real address.
- A fallback that made "this already exists" indistinguishable from "you are
  about to write into something that is not yours". The script now refuses to
  reuse an owner at all; `make seed-demo-reset` deletes and reseeds explicitly.

Nothing here was specific to seeding. Any script that writes on a user's behalf
should fail loudly on an identity it did not create, rather than proceeding on
a guess.

---

## Phase 9.7 — Observability: error tracking ✅ (Sep 2026)

Step 3 of the observability plan, deferred at the deploy and picked up now that
strangers can reach the app. **Sentry, EU region**, wired into the chokepoints
that Phases 1–2 of that plan had already built. Full write-up — vendor
reasoning, verification method, alert rules, limitations — in
`docs/DEPLOYMENT.md` → "Where the logs go".

**Backend**
- `backend/internal/observability/sentry.go` — the whole SDK surface, so nothing
  else in the codebase imports Sentry directly. `Init` / `Flush` /
  `CaptureError` / `CapturePanic` / `Fatalf`, all inert without `SENTRY_DSN`.
- `backend/internal/handlers/errors.go` — `serverError` reports as well as logs.
  One line, because step 1 had already funnelled every 500 through here.
- `backend/cmd/server/main.go` — `Init` + deferred `Flush`; `middleware.Recover`
  becomes `RecoverWithConfig` with a `LogErrorFunc` so panics reach the tracker
  (they never pass through `serverError`); `log.Fatalf` at the two boot-failure
  sites becomes `observability.Fatalf`.
- `render.yaml` — `SENTRY_DSN` (`sync:false`) and `SENTRY_ENVIRONMENT`.

**Frontend**
- `frontend/src/instrumentation-client.ts` — SDK init. This is a *Next* file
  convention (verified against `node_modules/next/dist/docs`, per `AGENTS.md`),
  which is why no build plugin and no `next.config.ts` wrapping is needed.
  Also exports `onRouterTransitionStart` for navigation breadcrumbs.
- `frontend/src/lib/scrubPII.ts` + `frontend/src/lib/reportError.ts`.
- `frontend/next.config.ts` — maps Vercel's `VERCEL_GIT_COMMIT_SHA` into
  `NEXT_PUBLIC_COMMIT_SHA` so releases tag themselves.

**`@sentry/browser`, not `@sentry/nextjs`.** The Next SDK pulls `@sentry/cli`,
whose postinstall downloads a binary — and this repo gates install scripts
through `allowScripts` in `package.json`, so that is a supply-chain decision,
not a detail. What it buys is source-map upload, and the app is entirely
client-rendered, so the server-side half of that SDK has nothing to instrument.
The cost is minified production stack traces. If a crash ever proves unreadable,
the two ways out are `productionBrowserSourceMaps: true` (public source maps, no
secret) or adding the upload step with a `SENTRY_AUTH_TOKEN` (private, one more
secret). Neither is needed until it is.

**Two corrections to what this doc previously said.** The Aug 2026 note claimed
any SDK would send the `Authorization` header and registration bodies by
default. `sentry-go` v0.49 does neither with `SendDefaultPII: false` — bodies
are not collected at all and the header deny-list already matches `auth`. The
scrubber is therefore the second layer, not the first; the *configuration* is
what carries the weight, and it is set explicitly rather than inherited from
what the SDK calls a backwards-compatibility path. Second, `sentry-go/echo`
requires **echo/v5** and this project is on v4, so the official middleware was
not usable — no loss, since `serverError` was always the better chokepoint.

**Verified rather than asserted.** `SENTRY_DSN` was pointed at a local server
capturing envelopes verbatim; the real binary then served a real 500 carrying a
planted `Authorization` header, cookie, API key and full registration body. The
captured payload had no body, no cookies, three benign headers, `token=[Filtered]`
in the query string, and the Postgres cause intact. A panic route (added, used,
reverted) produced a fatal event with an 8-frame stack. The frontend was crashed
inside its real error boundary: phone, Aadhaar and email `[redacted]` everywhere
including console breadcrumbs. Also covered by unit tests both sides —
`internal/observability/sentry_test.go` (39 assertions incl. one driving the
SDK's own request builder, so an upstream default change fails the build) and
`frontend/tests/unit/scrub-pii.test.ts`.

**Known limitation, tested so it stays known:** names are not scrubbed. No
pattern distinguishes "Priya Sharma" from "Postgres Error". Structured data is
safe because bodies are never collected; the rule for strings we build
ourselves is now in CLAUDE.md.

**Also fixed here** (raised in the deploy session, never filed):
`backend/internal/handlers/tenants.go` mapped *any* `db.Get` error on the public
QR path to 404 "registration link not found", so a Neon outage told a stranger
in a corridor that the sticker they had just scanned was invalid — and logged
nothing. Same family as the errors PR #17 fixed, milder only because the error
was checked rather than discarded. Now `sql.ErrNoRows` alone is a 404 and
everything else is a reported 500. `PublicRegister` had the same shape in
`err != nil || !exists`, which conflated an outage with a missing owner; split.

**Live and confirmed, same day.** Sentry org created in the EU region, two
projects (`hostel-backend` Go / `hostel-frontend` Browser JS, both set up as
"Vanilla" — the Echo integration needs echo/v5 and `@sentry/nextjs` pulls
`@sentry/cli`, so neither framework SDK applies here). DSNs are in Render and
Vercel. Both ends verified end-to-end against the real deployments: the backend
boot log reads `error tracking: enabled (environment=production …)`, a real 500
arrived and grouped, and the browser console smoke test reached the frontend
project. Releases tag correctly — issues show `in release c36f9f602dc9`, the
merge commit.

**It found two live bugs in the first hour**, neither of which any test or code
review had caught. Both filed in `docs/BACKLOG.md` → "Found by Sentry": three
issues that are really one prepared-statement-crossing-connections bug on
`/api/collections` (hypothesis: Neon's pooled endpoint plus `lib/pq`), and a
missing upper bound on password length that turns a long passphrase into a 500
on both signup and the public registration path.

Worth recording plainly, because it is the argument for the whole change: the
app had been live for two weeks, and the first time anyone looked, it was
broken in a way nobody had noticed.

---

## Phase 9.8 — Fixing what Sentry found ✅ (Sep 2026)

Two bugs, both live, both invisible until error tracking existed. Full detail in
`docs/BACKLOG.md` → "Found by Sentry".

### Prepared statements crossing connections

Three Sentry issues, one bug. The tell was that two of the errors were each
other backwards — `bind message has 4 result formats but query has 17 columns`
and its exact mirror — meaning two queries had swapped protocol state on one
server connection, in both directions, simultaneously. Confirmed by the `route`
tags being **different endpoints** (`/api/collections`, `/api/tenants`), which
is what ruled out a collections bug and pointed below the application.

Cause: `DATABASE_URL` used Neon's *pooled* endpoint — PgBouncer in transaction
mode — while `lib/pq` uses the extended query protocol with unnamed prepared
statements. Those are per-session, so the pooler could route a Bind to a
different backend than the Parse that set it up.

The fix is one env var (the direct endpoint), and it is not ours to make: the
connection string is a secret in Render. What *is* ours is making sure this can
never be silent again:

- `backend/internal/database/database.go` — `IsPooledEndpoint(dsn)` plus a loud
  boot warning naming the symptom and the fix. Not fatal, because a future
  driver (pgx with `simple_protocol`) makes the combination safe and refusing to
  boot would be the wrong call on a live service.
- `backend/internal/database/database_test.go` — 10 cases. Half of them are
  cry-wolf tests: a database *named* `pooler`, a host called `pooler-test`, a
  username of `pooler`. A warning that fires on a correct configuration gets
  ignored, and then the real one gets ignored too.

The predicate never returns or logs the DSN itself — the string carries the
database password and the caller's whole job is to write to stdout.

Verified against the real binary, not just the unit test: a pooled host prints
the warning before the connection attempt, a direct host starts silently.

### Passwords over 72 bytes returned 500

`bcrypt.GenerateFromPassword` refuses input above 72 bytes. `Signup` checked a
minimum of 8 and no maximum, so a generated passphrase from a password manager
became "failed to process password" with a 500. `PublicRegister` had the same
shape with a minimum of 6 — worse, being on the public QR path.

- `backend/internal/handlers/auth.go` — `validatePassword(password, min)`, now
  shared by both. They had drifted, which is exactly how one bug came to live on
  two paths and be noticed on one.
- `backend/internal/auth/auth.go` — `HashPassword` maps bcrypt's error to
  `auth.ErrPasswordTooLong`, so a call site that forgets to validate still
  yields something classifiable instead of an opaque 500.
- Tests in both packages, including the trap: the limit is **bytes**, not
  characters. 25 Devanagari characters is 75 bytes — under the limit by any rune
  count, over it by the only measure bcrypt uses. Anything counting runes would
  let the original 500 straight back in.

### Note

This phase is the argument for Phase 9.7 in one line: the app had been live for
two weeks, and the first hour of looking found two real bugs, one of which was
intermittently breaking multiple endpoints for anyone using the app.

---

## Phase 14 — Flow & UX review 🔎

A deliberate pass over the whole product as a *user* rather than as its author,
against the deployed environment. Everything has been verified feature by
feature as it was built; nothing has ever been walked end to end by someone
asking "is this actually good".

**Run it against the deploy, not localhost.** Half of what this is for only
exists in production: CORS between Vercel and Render, uploads landing in R2,
cold starts on the free tier, real latency on a phone on mobile data.

**The flows to walk, each start to finish**
1. Owner signs up → creates a site, rooms, beds
2. Prospective tenant scans the QR → registers → owner sees them in Pending
3. Owner approves, assigns a bed, sets rent and deposit
4. Owner records payments — including a part payment and a backdated one
5. Rent day: collections list, the WhatsApp nudge, recording from the list
6. Tenant gives notice, from the portal and from the owner side
7. Settle & vacate — with dues, with an advance, with adjustments, and the
   "end without settling" path
8. Tenant portal: login, ledger, submit a payment proof, notice to vacate
9. The awkward ones: correcting a wrong start date, a stay with no bed, a
   tenant with two stays over time, month-end move-ins

**For each, three questions:** does it work, is the UX right, and what does the
backend do when the input is odd. Findings that are one-liners go to
`docs/BACKLOG.md`; anything structural gets promoted to a phase.

**Worth doing with fresh eyes.** A subagent reviewing flows it did not build is
genuinely better at this than the author is — ask before spawning one.

**Evidence this phase is not optional:** ten minutes of seeding a demo dataset
(2026-08-19) found that `POST /tenant/stays/:stayId/payments` had returned 500
on *every call since it was written* — the INSERT reused one placeholder across
a `DATE` and a `TIMESTAMPTZ` column, so Postgres rejected it with 42P08.
Tenants have never been able to submit a payment proof, which is a headline
feature of the portal. It survived because the e2e suite had `owner/` and
`public/` directories and no `tenant/` one, and because the handler returned a
generic 500 with the real error discarded. Both are fixed; the lesson is that a
surface with no test directory is a surface nobody has tested.

**Run the review against `make seed-demo`.** It builds every state the UI can
show, including the awkward ones — a bed-less stay, a paid-ahead tenant, a
settled move-out, a payment awaiting approval — which is most of the list above
already standing up.

---

## Phase 12 — Test Hardening 🔜

**Why this exists.** The tenant-summary bug (payments inflating the balance
owed) shipped while an e2e test named "tenant summary returns correct totals"
was passing. That test asserted `total_paid` (which was never wrong) and
`duration_days >= 0` (a tautology — the buggy value was 0), and never asserted
`total_expected` or `balance` at all. Its fixture started the stay *today*, so
the duration was zero and the per-payment multiplication was invisible.

The lesson is not "write more tests." It is:
1. **Assert exact values**, never `>= 0` or `toBeTruthy()` on a number.
2. **Fixtures must be non-degenerate** — multi-month stays, several payments,
   partial payments, backdated dates. A zero-length stay hides arithmetic bugs.
3. **Money math belongs in fast unit tests**, not only in e2e. The bug was pure
   arithmetic; a table test would have caught it in milliseconds without a
   browser or a database.

### 12a — Backend unit tests (money and dates) — do this first

No DB, no browser. Pure functions and aggregation logic.

- `cyclesElapsed`: join-date anchoring, month-end move-ins, short months,
  leap years, weekly/daily, same-day start, future start. *(partially done —
  `cycles_test.go`)*
- Summary aggregation: per-stay values must not scale with payment count;
  paying reduces balance by exactly the payment; multiple concurrent and
  historical stays; ended stays stop accruing; backfilled end dates.
  *(done — `summary_test.go`)*
- Bed status derivation (`vacant`/`paid`/`partial`/`overdue`/`vacating_soon`):
  table test over balance × notice × end-date combinations. The thresholds
  ("owes less than one cycle" vs "owes ≥ one cycle") are untested today.
- Dashboard revenue: expected vs collected this month, overdue totals, with
  several stays on different cycles and start dates.
- `formatCurrency` / paise conversions, including negative balances (credits).

### 12b — API integration tests (real DB, no browser)

Playwright `request` fixtures, as today, but with honest assertions.

- **Tenant lifecycle**: create → assign bed → record payments → give notice →
  end stay (backdated) → verify summary and grid status at each step.
- **Payment flows**: owner-recorded payment; tenant-submitted proof requiring
  approval; rejecting a proof; deleting a payment and confirming the balance
  moves back.
- **Date handling**: backdated payments, backdated stay start, backdated
  vacate, month-boundary stays, stays spanning a year boundary.
- **Overrides**: once stays become editable (see Known Issues), assert that
  correcting `start_date` / `rent_amount` recomputes every derived number.
- **Multi-tenancy**: owner A must never see or mutate owner B's data — one test
  per endpoint family. Currently untested and it is the security-critical
  invariant of the whole app.

### 12c — UI e2e (browser)

Keep thin — these are slow and will churn during the design phases.
One happy path each: create tenant via form, assign bed from grid, record a
payment from the grid drawer, approve a pending registration, end a stay with a
backdated date picker. Assert on user-visible money and dates, not internals.

### Conventions to adopt

- Every bug fixed from now on ships with a regression test that fails on the
  old code.
- Fixtures live in one place with builders (`stayStartedMonthsAgo(3)`), so a
  test that needs a realistic tenant doesn't hand-roll dates.
- `make verify-backend` (unit) must stay fast enough to run on every save;
  e2e runs before a PR.

**Sequencing note:** 12a is immune to UI churn, so it can land before the
design phases. 12c should wait until after design Phase D, or the tests get
rewritten twice.

---

## S1 — Data Integrity ✅

Stabilization pass. Priority set Aug 2026: make what exists correct before
building anything new.

- **`PUT /api/stays/:id` no longer clobbers fields you didn't send.** It wrote
  every column from the request body, so ending a stay (sending only
  `end_date`) silently set `notice_date = NULL`. Absent keys are now
  distinguished from explicit `null` by parsing the raw JSON keys —
  `c.Bind` into pointers cannot tell those apart, since both arrive as nil.
- **Stays are correctable.** `start_date`, `rent_amount`, `deposit_amount`, and
  `rent_cycle` are now editable. Previously a stay entered with the wrong start
  date had every derived number wrong forever with no fix path.
- **Validation on the resulting row**, not just the payload: end can't precede
  start, notice can't precede start, rent must be positive, cycle must be one
  of the three. Reopening a stay (clearing `end_date`) 409s if another active
  stay now holds the bed.
- **Month-end move-ins no longer skip a cycle.** The anchor day is clamped to
  the last day of the month being measured, so a stay starting the 31st rolls
  over on Feb 28 (29 in a leap year) instead of not at all.
- **`rent_due_day` dropped** (migration `004`) from the schema, models,
  handlers, import CLI, API types, and the pending-page form. Per the decision
  above, billing anchors to each tenant's join date, which is what
  `cyclesElapsed` already did — the column was dead config that looked live.

Tests: partial-update semantics (absent vs null vs value, zero treated as a
real value, malformed input rejected), month-end and leap-year cycle clamping,
30th-of-month move-ins, and that correcting a start date moves the expected
total. `make verify-backend` and `make test-e2e` (12/12) green.

---

## S2 — Money Math Unit Tests ✅

Phase 12a continued: the arithmetic that decides what a bed looks like and what
the dashboard claims you are owed is now covered by fast tests with exact
assertions. No DB, no browser — `make verify-backend` runs in under a second.

- **`computeBedStatus` (`grid.go`)** — `grid_status_test.go`. Table tests over
  the paid/partial/overdue boundaries: the one that matters is that owing
  *exactly* one full cycle is overdue while owing one paise less is partial, and
  that the threshold scales with the stay's own rent (₹5,000 short is partial on
  a ₹12,000 room, overdue on a ₹5,000 one). Also: zero rent is always paid, the
  30-day vacating window is inclusive at 30 days and open-ended in the past
  (backfilled vacates), notice outranks any end date, and vacating outranks the
  money status. `buildBed` is exercised end-to-end from a `gridRow` so the
  cycles → expected → balance → status chain is covered, not just the last step.
- **Dashboard revenue (`dashboard.go`)** — `dashboard_revenue_test.go`. The
  rollup loop was extracted from the handler into `computeRevenue(stays,
  collectedThisMonth, today) RevenueSummary` (with `stayRevenueRow` promoted to
  a package-level type) so the tests exercise production code rather than a
  copy of it. Fixtures are a five-stay portfolio on three cycles with start
  dates from February to mid-August: a monthly anchor day that has *not* come
  round yet contributes 0 to expected-this-month while one on the 1st
  contributes a full rent; a stay started mid-month bills its whole first cycle
  this month; weekly/daily stays cross several cycles inside one calendar month;
  a tenant paying ahead contributes 0 to overdue instead of netting off another
  tenant's arrears; a future start contributes nothing.
- **`formatCurrency` (`frontend/src/lib/api.ts`)** — `frontend/tests/unit/`.
  Exact rendered strings: lakh/crore grouping (`₹1,00,000`, not `₹100,000`),
  negative amounts keeping the sign outside the symbol, half-up rounding of
  sub-rupee paise. Note the two backend sign conventions are opposite — the
  tenant summary reports `expected − paid` (negative = credit), the grid reports
  `paid − expected` (negative = owes) — so both directions are asserted.
  Found in passing: `formatCurrency(-0)` renders `-₹0`. Pinned as a tripwire
  rather than fixed; Go marshals a zero `int64` as `0`, so `-0` cannot arrive
  from the API today.

**New runner:** the frontend had no unit-test runner (`make test` called a
non-existent `npm test`). Rather than adding vitest, unit tests run under
Playwright with a separate `frontend/playwright.unit.config.ts` — `testDir:
tests/unit`, no `webServer`, so nothing boots Go or Next. New targets:
`make verify-frontend`, and `make test` now runs both unit suites.

---

## Design Phase B — Component Kit ✅

Full detail in `docs/DESIGN_PLAN.md`. In short: `frontend/src/components/ui/`
now holds the whole vocabulary — `Button`, `Card`, `Field`/`Input`/`Select`/
`Textarea`/`FileInput`, `Badge`/`CountBadge`, `Banner`, `StatusPill`, `Drawer`,
`Modal`, `ConfirmDialog`, `EmptyState`, `PageHeader`, `Skeleton`, `Toast` —
and every owner-side page has been converted to use it. The grid's side column
and the pending page's hand-rolled overlay are now the shared `Drawer`; the
assign-bed modal is the shared `Modal`.

**`window.confirm` is gone from the owner app.** `useConfirm()` returns a
promise and renders a real dialog. This was a test-correctness fix too:
Playwright auto-dismisses native dialogs, so any e2e test covering a delete or
vacate would have silently exercised the cancel path.

**Frontend unit runner arrived with S2**, so `make verify-frontend` covers the
kit's pure helpers alongside `formatCurrency`.

Verification: `npx tsc --noEmit` clean, `npm run build` clean,
`make test-e2e` 12/12, and the converted pages driven by hand in a browser —
including the vacate flow end to end (confirm → stay ended → grid refreshed →
bed reads Vacant → scroll lock released).

Two follow-ups deliberately left for later phases: the tenant portal and public
registration pages are untouched (Phase C–E pick them up opportunistically),
and `Toast` is mounted but not yet wired into mutations (Phase E).

---

## Design Phase C — Responsive Shell ✅

Full detail in `docs/DESIGN_PLAN.md`. The sidebar now appears from 1024px up;
below that it becomes a bottom tab bar (Dashboard, Collections, Sites, Tenants,
Pending, both count badges carried over) plus a slim top bar holding the
wordmark and an account menu with sign out. One nav definition drives both.

Every owner page was walked at 375×812: no horizontal scroll and nothing
clipped inside a container. Three pages needed real work rather than padding —
the tenants table became a stacked list below `sm` (five columns wrapped every
cell onto two lines), pending's Approve/Reject buttons moved to their own row
(they were clipping the tenant's email mid-address), and the two- and
three-column form grids stack.

**The mobile top bar shows the wordmark, not the page title.** The plan asked
for the title, but every page already opens with its own `<h1>` and the tab bar
shows the active section, so it read as a duplicate on screen.

**A latent e2e race got fixed on the way.** Every UI test logged in with
`goto("/")` → `setItem("hostel_token")` → `goto(target)`. The first navigation
boots the app unauthenticated, which schedules a redirect to `/login`, and that
redirect can land *after* the second `goto` and steal it — the test then sits on
the dashboard (or the login page) looking for something that was never going to
be there. It had been passing on luck; two tests started failing about one run
in two. There is now a shared `loginAs()` helper using `addInitScript`, which
seeds the token before any page script runs. This touched the two pre-existing
test files too. The suite went from flaky at 46s to stable at ~10s, verified
across three consecutive clean runs.

Tests: `tests/e2e/owner/responsive.test.ts` — every page at 375px asserted for
both horizontal overflow and clipped-inside-`main` content, tab bar vs sidebar
at each breakpoint (by geometry, not by class name), tab navigation setting
`aria-current`, and the account menu signing out.

---

## Design Phase D — Hero Screens ✅

Detail in `docs/DESIGN_PLAN.md`. The grid became room cards with 96px bed tiles
(status as a left stripe over a pale tint, initials avatar, amount owed), the
legend became a filter with counts, and the dashboard got tinted stat-card
icons, a collected/expected progress bar, a red stripe on overdue, and one
consolidated "Needs attention" card. D3 landed with it: Fraunces on the wordmark
and page titles only, and an icon plus a real next step on all nine empty
states.

**This closes the vacate-backfill known issue.** The grid and the tenant page
now render the same `EndStayDialog`, so a departure recorded three days late is
billed to the day it happened from either screen.

The automated design review did not run, and could not have — the script it
called has never existed (see "Deferred" below). Before/after screenshots were
taken by hand instead.

---

## Design Phase E — Feedback Layer ✅

Detail in `docs/DESIGN_PLAN.md`. Toasts on all eighteen owner mutations, the
last `window.confirm` replaced (it was the tenant portal's notice-to-vacate,
which meant mounting `ConfirmProvider` and `ToastProvider` in the tenant shell),
and a sweep of loading states.

Three real defects surfaced while wiring it, none of them cosmetic:

1. **Silent failures.** `pending`'s approve/reject ended in
   `catch { /* ignore */ }`, and two payment deletes had no `catch` at all. A
   failed request left the row sitting there as though nothing had happened.
2. **The clipboard button claimed success it hadn't earned** — it toasted
   before awaiting `navigator.clipboard.writeText`, which rejects on a denied
   permission or an unfocused document.
3. **Width props on kit inputs had never worked.** `<Input className="w-32" />`
   was silently ignored since Phase B, because Tailwind resolves conflicting
   utilities by CSS source order rather than by the order in the class
   attribute, so the base `w-full` always won. `Field` now strips the base
   width when the caller sets one. Worth remembering the next time a kit
   component takes a `className`.

One e2e assertion was tightened rather than the code changed: the tenant test
looked for `getByText("Ended")`, which now also matches the toast's "…'s stay
ended". It asserts the badge exactly.

---

## Real-hostel setup — Chopra Boys Hostel is on production ✅ (Sep 2026)

The app now holds a real account alongside the demo one: owner #4, site #1,
7 rooms, 45 beds, all vacant. Tenant details go in by hand afterwards.

`scripts/seed-chopra.py` (`make seed-hostel`) exists because `seed-demo.py`
cannot be pointed at a real account — it invents an owner and fills it with
fiction. The new script is narrowed to match its target: **sites, rooms and beds
only**, never a tenant, stay or payment; never a delete or an update; idempotent
on re-run, so the `LAYOUT` table at the top of the file stays the source of truth
rather than the UI. Worst case against live data is an empty room.

It **logs in before trying signup**, which is the inverse of the fallback that
caused the incident recorded above. A 401 answers "does this account exist"
without guessing, and a 409 on the signup that follows means the password is
wrong — at which point it stops, having written nothing.

Rehearsed against a local backend under a throwaway `.invalid` owner before it
touched production: fresh signup, idempotent re-run, and a wrong-password
attempt that refused. Then verified on production by reading the grid back from
the API rather than trusting the script's own output.

**Bunk beds are named, not typed** — `1L`/`1U`. A `bed_type` column would need a
migration plus API and UI changes and nothing would branch on it: rent lives on
the stay, not the bed, so an upper bunk can already be cheaper without the schema
knowing why. Full reasoning and the caveats (positions under 10; short custom
labels) are in `DEPLOYMENT.md` → "The live owner account".

Credentials live in `.hostel-credentials.env`, gitignored — **this repo is
public**. Note the app has no change-password feature, so rotating means a direct
database update.

Shipped alongside: the Collections icon had no stem, so two bars plus a
free-floating lobe scanned as a struck-through "3" rather than ₹. The bowl now
closes onto a stem with the leg descending from it, checked side by side against
a real ₹ glyph.

---

## Phase 15 — Insights ✅ (Sep 2026)

The first historical view in the app. Everything else answers "what is true
now"; `/insights` answers "what has been happening".

**`GET /api/insights?months=N`** (1–24, default 12) returns all three views in
one payload — one endpoint rather than three because they share a window, and
fetching them separately invites a 12-month revenue chart above a 6-month room
table on the same screen.

Three decisions worth not re-litigating:

- **Expected is differenced from billing cycles**, exactly the way the
  dashboard's single figure is, so the last point of the series equals the
  dashboard's "expected this month" card. A unit test pins the two together —
  two screens disagreeing about the same month is a bug report waiting to
  happen.
- **Collected is keyed by the month the money arrived**, not the month it was
  owed for. Three months of arrears cleared in one payment is one tall bar. The
  gap against expected is the point of drawing them together.
- **Occupancy is bed-nights, not a month-end headcount.** A snapshot scores a
  bed that turned over on the 2nd the same as one empty until the 30th. The
  denominator is *today's* bed count applied to every month — deliberately not
  `beds.created_at`, because this app is built for backfilled data, so a bed row
  entered this morning may describe a bed that has existed for years. The cost:
  adding a room today makes past months look emptier than they were.

The current month is measured to today rather than to month-end, so a full
house reads 100% on the 11th instead of 35%.

**Charts are hand-rolled SVG** (`components/ui/Chart.tsx`). The frontend has
four runtime dependencies (react, react-dom, next, @sentry/browser) and a
charting library plus its d3 transitive deps would be a conspicuous addition;
what these draw is a hundred lines of SVG, and rolling it keeps the stone/indigo
tokens identical to every other surface. `ChartScroll` gives a wide series a
minimum width and scrolls it inside its own container, so the page never scrolls
sideways at 375px.

**The tab bar is six items now, not five.** Insights earned a slot because it is
the only answer to "how are we doing" and burying it behind a menu is how a
feature goes unused. Six is the ceiling — labels still fit untruncated at 375px.

`SegmentedControl` was extracted to `components/ui` for the range picker rather
than hand-rolled on the page, because its selected state is the same
`ring-stone-200` recipe Card owns.

Tests: 9 Go unit tests on the pure functions (`insights_test.go`) — including
that an ended stay stops billing, a bed-less stay bills but occupies nothing,
and an `end_date` counts as the tenant's last night — plus 3 Playwright tests
covering an empty room appearing at ₹0, the range picker refetching, and 375px
with no horizontal page overflow.

### Phase 15b — a demo dataset with a shape ✅

`seed-demo` covered every *state* in 9 stays over 7 months, which drew a flat,
monotonically rising chart — technically correct and useless for judging whether
the charts work. It is now **20 beds across 2 sites, 15 months, 19 stays**.

The layout is deliberately uneven, because a demo where every room performs
identically cannot show that the per-room table works: Room 101 is never empty,
Room 102/1L turns over three times on one bed, HSR Room 3 is never let at all
and reads 0%. Beds are re-let after a gap — the API only refuses a second
*active* stay, so rows for a reused bed are ordered oldest-first and each is
ended before the next begins.

Two tenants (`Manish Tiwari`, `Gaurav Rane`) exist purely to make the occupancy
line *fall* — they leave within a month of each other around month 8 and nobody
replaces them. Without a dip the chart is indistinguishable from a ramp, and a
ramp does not prove the chart is reading the data.

Payment patterns are declarative (`ontime`, `late`, `arrears:N`, `partial`,
`upfront:N`), which is what opens the collected-vs-billed gap from June onward
and puts a spread of "last payment" dates on the collections screen. Meera's
payment stays unapproved on purpose, so HSR Room 1 reads ₹0 collected while
occupied — correct, and worth having in front of you.

### Phase 15c — the charts answer "how much", not just "roughly" ✅

Feedback on first use: *"I cannot really tell what is the exact value"* and
*"By room and Occupancy might've been better as foldable panels"*. Both fair.

- **Hover readout** on both charts — full-height hit columns, so it triggers
  anywhere in the month rather than on a 14px bar. The tooltip shows the exact
  rupee figure (`formatExact`), not the compact axis form: the whole reason to
  hover is to stop estimating, so `₹1.2L` there answers the wrong question.
  Occupancy adds the bed-nights behind the percentage.
- **`Collapsible`** (`components/ui`) for Occupancy (open) and By room (shut).
  The summary is the point — "8 rooms · 1 never let" often answers the question
  without opening the panel. Content unmounts rather than hides, so a folded
  chart is not measuring a zero-width container and caching a broken layout.
- **Charts now measure their container** instead of declaring a fixed viewBox.
  The first version hardcoded `viewBox="0 0 280 200"` and let the SVG scale,
  which preserves aspect ratio — so a 3-month range drew its bars in a 280px
  island floating in the middle of a 1000px card. Width is also capped at
  `n × 96px` so three months do not stretch into three lonely bars.
- The page was missing the `p-4 sm:p-6 lg:p-8` wrapper every other dashboard
  page has, so it rendered flush to the edge.

### Phase 15d — the dashboard's two lists ✅

Three pieces of feedback after using the dashboard against the widened demo
data, plus one bug found while checking them.

**Rows are links now.** Both lists showed a tenant's name with no way to reach
them — `BACKLOG.md` had recorded this, correctly noting it was not a `<Link>`
around existing data: neither query selected `t.id`. Both now carry `tenant_id`,
and the vacating list carries `stay_id` as its React key, because `stays.go`
only blocks a second active stay on the same *bed* — one tenant can hold two.

The trap worth naming: `RecentPayment.ID` is the **payment's** id and now sits
directly beside `tenant_id`. Linking to the wrong one lands the owner on a
stranger — in the demo data, payment 957 versus tenant 881. Both are commented,
and an e2e asserts the href is not `/tenants/<payment id>`.

**The lists peek at five.** They were never going to grow unboundedly — both
queries were already `LIMIT 10` — so the actual complaint was that they truncate
*silently*, and that `lg:grid-cols-2` stretched the shorter card to leave dead
whitespace. Now: five rows and a `Show all N` button, `lg:items-start` so a card
ends where its content ends, and the queries ask for `LIMIT 11` so the response
can carry `vacating_truncated` / `recent_payments_truncated`. Without that flag
the UI would cheerfully offer to "show all 10" of a forty-row list.

Rejected: a max-height scroll box. There is not one vertical nested scroller in
this app (`ChartScroll` is horizontal on purpose), and it would have hidden the
truncation exactly as silently as before — reaching the bottom of a scroll box
tells you nothing about whether the server sent ten or ten-of-forty.

**Six tabs stay six.** The suspicion was that Dashboard, Collections and
Insights overlap. Collections is a worklist that empties as you work it, not an
overview. Dashboard and Insights overlap in exactly one number — "Collected This
Month" is the last bar of the collected-vs-billed chart, and `insights_test.go`
pins them equal — so that card is now a link to `/insights`. A shared number
between a summary and its series is how they are supposed to relate; the fix is
a doorway, not a merge.

**The bug:** the vacating query read `WHERE ... AND s.end_date IS NULL AND
(s.notice_date IS NOT NULL OR s.end_date <= CURRENT_DATE + INTERVAL '30 days')`.
The second branch is unreachable under `end_date IS NULL`, so the 30-day window
never fired and the empty state — "No tenants vacating in the next 30 days" —
described behaviour that did not exist. Predicate collapsed to `notice_date IS
NOT NULL`, copy is now "No one has given notice", and `ORDER BY` gained an
`s.id` tie-break so a `LIMIT` cannot return rows in non-deterministic order.

Deliberately **no** date window added: `notice_date >= CURRENT_DATE - INTERVAL
'30 days'` would hide the tenant who gave notice 45 days ago and is overstaying,
which is the one most worth seeing.

**Tests.** The dashboard had no e2e file at all — by this repo's own rule, a
surface nobody had tested. `tests/e2e/owner/dashboard.test.ts` now covers the
notice click-through, the payment row linking to the tenant rather than the
payment, the empty-state copy (the only automated guard on the predicate, since
every Go handler test is a pure-function test and none reach this SQL), the
expander, and the card-stretch regression. That last one was checked by removing
`lg:items-start` and confirming it fails.

**Next:** nothing queued. Insights is worth living with for a while before
adding average-days-late or revenue-per-bed-position on top of it.

---

## Phase 16 — Feedback from running the real hostel ✅ (Sep 2026)

The first round of items found by the owner *using* the app against real
tenants rather than by building it. The full list is in `docs/BACKLOG.md`;
three landed here, and the rest are named at the bottom.

### 16a — Deleting a bed or room could destroy a rent ledger ✅ (#30)

Deleting a bed someone had ever occupied destroyed their stay **and their
entire payment history**, unrecoverably, behind a confirm that said only
"Delete this bed?" and then toasted "Bed removed". A room did it to every bed
at once. `beds → stays → payments` is `ON DELETE CASCADE` at every link and
neither handler had a guard. This was live on an account with real rent history.

`ledgerFootprint` counts what the cascade would take, and both handlers now
return **409 when any stay references the bed — ended or not**. "They moved
out" is not a reason to lose the ledger. The cascade is untouched on purpose:
loosening it would leave orphaned stays pointing at beds that no longer exist.

The refusal names **counts only** — "2 stays and 14 payments" — never a tenant.
Counts are structural and safe to build into a string; a name is the thing the
Sentry scrubber cannot catch.

The frontend was swallowing it regardless: `catch { toast.error("Failed to
delete room") }` threw the server's message away, so a careful refusal would
have surfaced as a generic failure. Fixed, and the confirm names the room or
bed instead of "this room".

Found while testing: the bed's remove button had `title="Remove bed"` but text
content `×`, and text content wins the accessible name — a screen reader
announced it as "times". It carries an `aria-label` now.

### 16b — A departure gets its own date ✅ (#31, migration 006)

`notice_date` was **read** in three owner-side places and **written** in exactly
one — the tenant portal — and an owner-created tenant has no portal login at
all, so recording a notice was not awkward for them, it was impossible.

The backlog guessed `notice_date` could double as the departure date. It
cannot: the portal stamps it with `time.Now()`, so every tenant tapping "I'm
leaving" would be saying "I leave today". And `end_date` cannot hold it either
— `end_date IS NULL` is what *active* means everywhere, so a future one frees a
bed while the person is still in it.

Three facts, three columns: `notice_date` (they told you), `expected_end_date`
(they say they're going), `end_date` (they went).

**Nothing acts on the expected date.** People overstay and leave early, and only
a human knows which, so the stay stays open and rent keeps accruing. What was
missing was the *question* — left alone, a passed date sits inside the
within-30-days window forever, so a bed would stay orange for months with
nothing separating "leaving next week" from "was due to leave in June".

Hence `departure_due`: a sixth bed status, purple, deliberately outside the
money palette because it says nothing about money. It **outranks arrears** —
someone three cycles behind who may have moved out a month ago needs "did they
actually go?" answered before their balance means anything. Plus a row in the
Needs-attention card, which already gates itself on there being something to
attend to.

The answer is two-sided: **"They're staying"** clears the date as an explicit
button, not by emptying a date input. Without it, lying — recording a departure
that never happened — would be the only way to stop a reminder.

`computeBedStatus`'s `end_date`-within-30-days branch was **resurrected, not
deleted**. It could never fire (the grid only loads `end_date IS NULL`, so the
parameter was always nil) and had a passing test asserting unreachable
behaviour, including a case named "backfilled vacate". It was the right idea
without a field to read.

The portal learned the date too. Its confirm used to promise "they will contact
you about the move-out date" — a workaround wearing a sentence. It now takes an
optional date and refuses a backdated one: claiming you already left is a
statement about the past, and only the owner can see the bed.

### 16c — A settled stay still read as owing ✅

Reported with the owner's own numbers: ₹5,000 billed, ₹2,500 paid, ₹1,000
deposit held, remaining ₹1,500 written off at the counter. The settlement netted
to zero and Collections showed nothing pending — but the tenant page kept
reading **"₹2,500 owed"**.

`TenantHandler.Summary` computed `Balance = TotalExpected − TotalPaid` across
every stay and never looked at the settlements table at all. Collections was
right by accident: it only ever considers active stays.

`Balance` is now a question about the present — *what does this person still owe
me* — and a settled stay has already answered it. `TotalPaid` and
`TotalExpected` are history and still accumulate. The settled case is
deliberately asymmetric:

- `refund < 0` — the tenant was short at the counter, so it still counts.
- `refund > 0` — the **owner** owed them, and recording a settlement is
  recording that handover. Not a tenant credit, so it counts as zero rather
  than leaving them "ahead" forever.

**Why it survived:** `summary_test.go` had a `summarize` helper that was a
hand-written copy of the handler's loop, commented "kept in sync deliberately".
The copy and the real thing agreed perfectly and both ignored settlements. A
test that reimplements the thing it tests can only confirm its own arithmetic.
`computeTenantSummary` is extracted now and the suite calls it — the seven
existing cases exercise production code, plus four new ones.

### Also: `make migrate` printed the production database password

The recipe line had no `@` prefix, so make echoed the command before running it
— full Neon connection string, password included, to the terminal and any CI
log. `migrate-down` too. Found while running 006 against production, which is
exactly the situation the leak was waiting for.

### Operational note — migration 006 on production

Applied 8 Sep 2026, verified by column and index rather than by version number:
a half-applied migration reports its version but leaves the schema inconsistent.

Local DNS refused to resolve the Neon pooler host (`REFUSED`, not `NXDOMAIN`;
`dig @1.1.1.1` resolved it fine, and Render reached the database throughout) —
an ISP resolver issue, worked around by changing the resolver. Worth knowing
before assuming a migration failure means a dead endpoint.

### 16d — The last five feedback items ✅

The five that were still open, closed in one session. Four of them turned out
to be the same shape: something the app already had, that no screen ever
offered.

**An owner can now give a tenant a portal login.** `TenantAuthHandler.Login`
required a password hash and only the public registration form ever wrote one,
so every tenant an owner typed in by hand was locked out of `/my` permanently.
That is what made the standing rule — *no capability may be
tenant-portal-exclusive* — a correctness rule rather than a symmetry one: a
portal-only action was not merely awkward for those tenants, it was unreachable
forever. `PUT /api/tenants/:id/portal-password` sets one, owner-scoped like
every other write, sharing `validatePassword(pw, 6)` with public registration
so the two paths cannot drift apart the way the bcrypt-72 bug did.

It is a **set**, not a change: the owner never knew the old password. The
dialog says so, offers "Show password" because the owner has to read it aloud,
and warns that it cannot be read back.

The hash still never leaves the process. What leaves is a computed
`has_portal_login`, derived in `tenantCols` as
`password_hash IS NOT NULL AND password_hash <> ''` — because "can this person
sign in?" is a question the owner side has to be able to answer, and there was
no way to ask it. The login query changed to `password_hash <> ''` at the same
time, so there is exactly one spelling of that predicate.

**Rooms and beds can be renamed.** `PUT .../rooms/:id` and `PUT .../beds/:id`
had both worked since Phase 2 with **zero call sites** in the app or the tests
— built, wired, never surfaced. Since 16a correctly refuses to delete anything
with a ledger behind it, the workaround for a typo in a room number was to keep
the typo. A pencil on the room header and on each bed chip, both editing in
place.

Found doing it: the chip's buttons were `hidden ... group-hover:inline`, which
took them out of the tab order entirely — the `×` had been unreachable by
keyboard since it was written — and on a phone, which has no hover, they never
appeared at all. They now fade from `sm` up and stay visible below it.

**A tenant can be placed in a bed while being created.** `/tenants/new` made a
*person* and nothing about where they would sleep; the only `staysApi.create`
call site in the whole frontend was the grid, so adding a tenant meant filling
the form and then walking Sites → site → room → bed → assign.

The backlog said to reuse the grid's assign form rather than grow a second one.
There were already **four** copies of these fields — the grid drawer, the
pending-approval drawer, the tenant page's assign modal, and nothing at all on
the new-tenant form. They had already drifted: only the pending drawer's rent
label followed the billing cycle, so the grid asked for "Monthly rent" while
collecting a daily one. `components/StayForm.tsx` now holds `StayTermsFields`
(with `stayTermsPayload` as the one rupees→paise conversion) and `BedPicker`,
and the three existing call sites use them.

The terms are validated **before** the tenant is created, and a stay that fails
after the tenant exists says so rather than throwing the submission away — the
same honesty as the backend's "tenant approved but failed to create stay".

**The registration form asks for a photo.** The column and the owner-side field
both existed; the payload simply carried no `photo_url`. The tenant is standing
in a corridor with a phone, which is the cheapest moment in the system to get a
face on the record. `IdProofField` became `UploadField` with an `accept` prop —
and still no `capture` attribute on any of them, because forcing the camera
would break picking an existing photo out of the gallery, which is the part of
this page the owner said already works well.

**And the Email field no longer implies it is a login.** It never was: portal
login is phone + password and email takes no part in authentication. The field
now says "For contact only — you sign in with your phone number", the password
hint names the number they just typed, and `/my/login` says it under the
heading.

Tests: `owner/portal-access.test.ts`, `owner/rename.test.ts`,
`owner/place-on-create.test.ts`, plus four cases added to
`public/registration.test.ts`.

### 16e — A dialog that states a rule must not offer to break it ✅

Found by the owner using 16d, and it was 16a's guard wearing the wrong face.
The confirm read "A bed that anyone has ever stayed in cannot be deleted" and
then showed a red **Delete** button underneath. Pressing it produced the real
refusal as a toast. Two messages for one rule, the first a prophecy — and the
only way to find out which case you were in was to press the button.

The cause was structural, not copy: the page had no idea. The footprint lived
only inside `DeleteBed`, computed at the moment of refusal, so the client's
dialog was static text written in hope.

`ListRooms`/`ListBeds` — and `Create`/`Update` with them — now return
`stay_count` and `payment_count` per row, from `roomSelect`/`bedSelect`. With
the answer in hand before the click, the page explains instead of asking:
`useConfirm` gained an `acknowledge` mode that renders a single dismiss button
and no confirm at all, and the trash/× greys out while staying clickable — a
disabled control explains nothing, least of all on a touch screen with no hover
to reveal a tooltip.

Create and Update recompute rather than returning a bare row, and that is the
subtle part. A rename response replaces the row in the page's state, so a
stripped-down one would have quietly turned an undeletable bed back into a
deletable-looking one. `stay_count: 0` now always means "nothing to lose"
rather than "nobody asked".

The counts and the guard are two pieces of SQL that must agree forever, so the
test asserts the agreement rather than the numbers: for every bed in a room,
whatever the list reports as deletable must return 200 and whatever it reports
as blocked must return 409. `owner/delete-guard.test.ts`, which also replaced
its old "the UI shows the server's reason" case — that test asserted the very
behaviour this removed.

70 e2e specs pass.

---

## Deferred

Moved out of this file on 26 Oct 2026. What is deferred is on the board
(`~/Projects/board/lists/hostel.md`, under "Parked"), with write-ups in
`docs/BACKLOG.md`: the isolation tests and password reset, both due before a
second owner. The automated design review was dropped; its write-up is in
`docs/DONE.md` → "Dropped".

---

## Known Issues

Found while verifying the billing fixes (Aug 2026). None are fixed yet.

### ~~Vacate-from-grid can't backfill a date~~ ✅ fixed in design Phase D
Both paths now render the shared `components/EndStayDialog.tsx`, so the grid and
the tenant page ask for a move-out date the same way and bill to the same day.

### ~~Collapsed stay cards show "Paid ₹0"~~ ✅ fixed in Phase 11
The ledger is still lazy-loaded on expand, but the card now reads "Paid —"
until the payments arrive rather than claiming zero. Fixed when the settlement
work put a refund figure next to it, where a false zero stops being cosmetic.

---

## UX audit — seven fresh-eyes sessions ✅ (Sep 2026)

The first testing round run by people who had not built the app. Seven personas
walked it cold — no source, no `BACKLOG.md` — each with a job to do: a day-one
owner with an empty account, the monthly chase on a phone, a full move-in to
settlement, the QR stranger plus the approval queue, the tenant portal, the auth
edges, and a month-end read of the numbers. Method and full ranked findings:
`docs/UX_REVIEW.md`; the actionable list is `docs/BACKLOG.md` → "Found by the UX
audit".

Run against `98520c3` on an isolated stack — a separate `hostel_ux` database and
non-default ports — so that a concurrent branch and the dev database were never
touched. No product code was changed in this pass.

**What it was worth.** Three blockers, none of which any existing test could
have caught: settling a stay refunds a deposit computed from the agreed rent
*term* rather than money actually received; correcting a payment is impossible
on a phone because the only delete is `hidden … group-hover`; and an owner can
neither change nor recover a password, while sign-out does not revoke the token.
Five open backlog items were rediscovered independently, which is the useful
signal — a thing three strangers hit is not a papercut.

**Two lessons about our own process, which are the parts to carry forward:**

- **Phase 16's lesson, inverted.** That phase closed seven capabilities the code
  had and no screen offered. This round, four testers reported that recording a
  payment from the tenant page was impossible — and the button is at
  `tenants/[id]/page.tsx:694`, behind an expander whose only affordance is
  `cursor-pointer`, which does not exist on a touchscreen. A feature five people
  cannot find is indistinguishable from one that was never built. Grep before
  believing a missing-capability claim, including our own: two of the audit's
  own findings were retracted this way, and one of them was my test rig, not the
  app (`BASE_URL` does not follow `PORT`).
- **A regression test can pass because of the bug it guards.**
  `insights.test.ts` asserts `documentElement.scrollWidth - clientWidth <= 1` at
  375px — which `overflow-x-hidden` guarantees *by clipping the charts it was
  meant to protect*. It also runs against a fresh owner with no data, so it
  never renders a chart at all. The charts really are drawn 672px wide inside a
  375px viewport with nothing scrollable; `ChartScroll` is correct and its grid
  parent never shrinks. Fix the test in the same change as the `min-w-0`.

**Still to run:** the production pass — read-only against the real account, a
throwaway owner for anything that writes, and cold-start latency timed. It is
the only way to see the pooler 500s and Render waking from sleep.

---

## UX audit blockers — B1, B2, B3, M1, M2 ✅ (Sep 2026)

Branch `ux-audit-blockers`, migrations 007 and 008. The first five items of
`docs/BACKLOG.md` → "Found by the UX audit"; the rest of that list was left
alone on purpose. Himanshu asked for the iPad, in both orientations, to be
treated as the likely primary device — which turned out to matter to B2.

### B1 — a settlement refunds the deposit received, not the deposit agreed (migration 007)

The audit's fix read "compute held deposit from recorded deposit payments".
There were no deposit payments: `payment_type` is `cash | online`, and every
payment counted as rent in nine queries. So the bug had two faces. A tenant who
paid nothing was offered the agreed deposit back (the audit's ₹8,000). And a
tenant whose deposit *was* written down — as an ordinary payment, the only way
the app allowed — got it back twice: ₹17,000 "deposit held" from the agreed
term, plus ₹17,000 "paid in advance" from the same money. ₹34,000 offered for
₹25,500 received.

- **Migration 007** adds `payments.kind` (`rent` | `deposit`, default `rent`).
  No backfill: every existing row was already being counted as rent, and
  inventing a deposit payment per stay would put money in the ledger that
  nobody recorded receiving. Production holds only test data (Himanshu, 11
  Sep), so a deposit mis-logged as rent is deleted and re-added — no
  reclassify tool was built.
- **Every rent sum filters `kind = 'rent'`**: settlements, grid, dashboard ×2,
  collections (the total *and* `last_payment_date` — a deposit last week is not
  a rent payment last week), insights ×2, the tenant summary. The bulk importer
  (`cmd/import`) takes a `kind` per payment too.
- The preview returns `deposit_agreed_paise` beside `deposit_paise`, which is
  now the deposit held. The drawer shows "₹16,000 agreed · ₹0 received" when
  they differ, and says only money received is refunded.
- Both payment forms (tenant page, grid drawer) ask Rent or Deposit; deposit
  rows are badged there, on the dashboard's recent list and in the tenant
  portal. The stay card shows the deposit, agreed against received — the
  audit's "the deposit appears nowhere".
- The pending queue's "collect deposit" explainer claimed the deposit "will be
  recorded as a payment". Nothing ever recorded one. Corrected; the option and
  button labels still overpromise (BACKLOG → "Smaller, verified, and cheap").
- **Tests.** Four Go cases on `previewFor` at exact paise, on the existing
  ₹8,500 / ₹17,000 fixture — nothing paid, part-paid in two instalments, the
  double count, overpaid — plus the frontend mirror in `tests/unit/deposit.test.ts`
  and an e2e that watches the refund go from −₹8,500 to +₹1,500 as ₹10,000 of
  deposit arrives while dues, the summary and Collections stay put.
- **The e2e suite had the bug in it.** `seedStayForSettlement` created a ₹17,000
  deposit and never paid it, and every settlement test then refunded it. It
  now records the deposit as a payment.

### B2 — hover-only controls, and the "correct" recipe was wrong on an iPad

Three destructive controls were still `hidden … group-hover:*`. The fourth, the
bed chip Phase 16 had fixed with `sm:opacity-0 sm:group-hover:opacity-100`, was
broken too: it keys off *width*, an iPad is wider than `sm`, and Tailwind v4
wraps every `hover:` variant in `@media (hover: hover)`, which a touch iPad does
not match. On the primary device the bed controls were invisible and still
tappable by accident.

- `HOVER_REVEAL` in `components/ui/reveal.ts` —
  `pointer-fine:opacity-0 group-hover:opacity-100 focus-visible:opacity-100` —
  hides a control only when there is a mouse. Applied to all four; the payment
  deletes gained an aria-label naming the amount and a 36px target.
- `tests/unit/hover-reveal.test.ts` scans `src` and fails on either old pattern.
  `tests/e2e/owner/hover-reveal.test.ts` taps every one of them on a phone and
  an iPad in both orientations under touch emulation — after first asserting
  the browser reports no fine pointer and no hover, so it cannot pass on a
  mouse by accident — and checks the mouse case still hides until hover and
  shows on keyboard focus.

### B3 — an owner account screen, and sign-out that revokes (migration 008)

- **Migration 008** adds `owners.token_version`; owner JWTs carry it as `tv`,
  and `AuthMiddleware` compares it on every request (one primary-key lookup). A
  counter rather than an "issued before" timestamp, because `iat` has
  one-second resolution. Tokens minted before the claim existed decode as 0, the
  column default, so deploying this signs nobody out. A failed lookup is a 500,
  not a 401 — a database outage must not bounce the owner round a login loop.
- `PUT /api/me/password` (current + new; a wrong current password is a 400, not
  a 401, which every client reads as "signed out") bumps the version and
  returns a fresh token, so this device stays in and every other one is out.
  `POST /api/me/sign-out-everywhere` bumps it and ends this session too.
- `/account`, reached from the name at the foot of the sidebar or from the
  avatar menu — the nav stays at six tabs. Sign-out-everywhere lands on
  `/login?signed_out=everywhere` with a banner, by full page load: `logout()`
  followed by `router.replace` lost a race with the layout's own redirect to
  plain `/login`, which dropped the query string.
- **Scoped out: reset by email.** Nothing in the backend can send mail. A
  "Forgot password?" link with no sender behind it would be the half-build the
  brief warned about. The psql runbook in `docs/DEPLOYMENT.md` is still the
  recovery path, and now bumps `token_version` too.
- Plain sign-out stays local by design. M8 — owner sign-out leaving the
  tenant-portal token behind — is still open.
- **Tests.** Six Go middleware cases (current, revoked, pre-versioning token,
  deleted owner, lookup failure, tenant token), and `account.test.ts`: wrong
  current password, mismatch, change → both earlier tokens 401 with the "session
  has ended" message while this device carries on, sign-out-everywhere, and the
  screen reachable at 375, 768 and 1024.

### M1 — the ledger has a real button

The stay header was a `<div onClick>` with `cursor-pointer` as its only
affordance. It is now information and actions only; below it a full-width
`<button aria-expanded aria-controls>`, 44px tall, with a chevron and the
payment count, so a shut ledger still answers "did it save?". Every ledger
loads with the page instead of on expand — `Paid —` now lasts only as long as
the request, and a failure says so where the ledger would be. A single stay
opens by default. "Paid" is rent only, the same figure as the summary above it.
`tenant-ledger.test.ts` covers the default, the count, keyboard, several stays,
recording a deposit, and a tap on an iPad.

### M2 — Insights charts reachable at 375px

`min-w-0` on the Card that is the grid item. `insights.test.ts`'s mobile test
was rewritten: it seeds a year so the chart takes its natural 672px, then
asserts the scroller sits inside the screen, actually scrolls at 375, and
brings the latest month into view — at 375, 768 and 1024. **Run against the
unfixed page first:** it failed with the scroller's right edge at 708px on a
375px screen, which is the audit's measurement. A test that cannot fail on the
bug it guards is the thing this replaces.

### Operational note — deploying this branch

**Apply migrations 007 and 008 to Neon before the new backend deploys.** The new
queries read `payments.kind` and `owners.token_version` and will 500 against
the old schema. The old backend is unaffected by the new schema (both columns
have defaults and it reads neither), so the safe order is migrate, then deploy.
Verify by column, not by version number — see the migration 006 note.

### Verification

`go test ./...` passes (auth, handlers, middleware and the rest). Frontend unit
tests 43/43, including the deposit mirror and the source guard. Full e2e suite
**89/89** in one clean run. One existing test needed a locator change, not a
behaviour change: `tenant-profile-enrichment` looked for `₹2,500` once, and
with a single stay's ledger now open by default the payment row says it too.
One lint error remains in `contexts/auth.tsx` (setState in the restore-session
effect); it is on master too and was left alone.

The settle drawer was also checked in a real 768×1024 and 1024×768 touch
viewport (flush right, 512px wide). The in-app preview pane drew it half
off-screen at the same size. That was the pane's emulation — it sizes fixed
elements from its own 1280px window — and not the app. Worth knowing before
trusting that pane for any fixed-position overlay at tablet widths.

---

## Audit round two — M3, M4, M8, and the deposit labels ✅ (Sep 2026)

Branch `audit-majors-round-two`, started straight after #34 merged, in the same
conversation. No migration.

### M3 — "Collected this month" stops at today

`collectedWindow(today)` is `[1st of the month, tomorrow)` — the rule Insights'
`monthWindows` already used, so the two figures now agree. Its unit test is the
audit's own ledger: payments on the 2nd and 9th count, the 13th and 17th do not,
₹69,900 becomes ₹53,600.

Owner-recorded payments dated more than a day ahead are now refused
(`validatePaymentDate`), and both payment forms' date inputs carry a `max`. One
day of slack, not zero: the server's "today" is UTC and the owner is in IST, so
just after midnight in Pune their today is the server's tomorrow. Tenant-portal
submissions are always dated now and need no check.

### M4 — "Overdue" counts tenants without a bed

The dashboard summed only stays with a bed, so a tenant approved before being
given one — billed from day one — owed money in Collections and nothing on the
tile. The filter is gone; a bed is about occupancy, and what someone owes does
not depend on one. "Expected this month" now includes those stays too, which
Insights already did. The e2e test puts one tenant in a bed and one without and
asserts the tile equals the sum of Collections to the paisa.

### M8 — either sign-out forgets both sessions

`lib/session.ts` owns both localStorage keys and `forgetAllSessions()`; owner
sign-out, sign-out-everywhere and tenant sign-out all call it. The e2e test
holds both sessions, signs out of one side, and checks the other side asks who
you are — on desktop, from the portal, and from the avatar menu on an iPad.

**A test-harness lesson on the way.** The first version planted both tokens with
`goto` then `evaluate` and failed two runs in three. A logged repro showed the
app was fine — both sessions restored with 200s — but the dev server reloaded
the freshly compiled route by itself just after the plant, and the test's own
navigation raced it. Tokens are now planted by an init script that runs once
per tab (guarded by a sessionStorage flag), so there is nothing to race.

### The pending queue stops promising money

"Approve & collect deposit" / "Collect a deposit now" / "Approve & record
deposit" became "Approve & agree terms", a description that says to record the
deposit as a payment once it is paid, and "Approve & save terms". That option
has never recorded a rupee, and since #34 a settlement refunds only deposit
money received. The e2e approves through it and then finds "₹16,000 agreed · ₹0
received" and an empty ledger on the tenant page.

### Verification

`go test ./...` passes, with four new cases on `collectedWindow` and
`validatePaymentDate`. Frontend unit 43/43. Full e2e **94/94** (three new files:
`dashboard-rollups`, `session`, `pending-terms`); the session tests were also
run three times over, 9/9, after the harness fix. Lint is unchanged from master:
the `tenantAuth.tsx` setState-in-effect error is the same pre-existing pattern
as `auth.tsx`'s, and the two `<img>` warnings on the pending page predate it.

---

## Audit round three — M5, M7, M11, and the Vacating Soon dates ✅ (Sep 2026)

Branch `audit-majors-round-three`, in the same conversation as #34 and #35. No
migration.

### M7 — the tenant profile names the bed

`GET /api/tenants/:id/stays` now returns `site_name`, `room_name` and
`bed_name` beside each stay (LEFT JOINs, so all three are null for a stay
waiting for a bed), and the stay card reads "Room 202 · 1L · HSR Layout" where
it read `Bed #31`. Only that list carries the names — every other stay endpoint
still returns the bare row — so the tenant page replaces a stay from those
responses with `withPlace(updated, previous)` (`lib/api.ts`), and refetches
after assigning a bed, because the bed just changed.

**The bug the suite caught on the way.** The first version merged with
`{ ...previous, ...updated }`. The stay endpoints omit empty dates from their
JSON, so when "They're staying" cleared the expected date the key was simply
absent, and the spread brought the old date back. `vacating-notice.test.ts`
failed on it; `withPlace` copies the three names and nothing else.

### M11 — the bed picker says it is loading

`BedPicker` keeps `sites` null until the request answers, and says "Loading
your sites…" instead of "No sites yet". Both of its requests also used to fail
silently into an empty answer — "no sites", "no vacant beds" — and now show the
error with "reload the page to try again". It is one component, so this covers
`/tenants/new` and the tenant page's Assign bed modal.

### Vacating Soon — each date says what it is

The row printed `Notice: 2026-08-31` or `Leaving 2026-09-30`, and three testers
read the first as a departure. It now reads "Gave notice 1 Aug 2026 · leaving
8 Oct 2026", "… · no leaving date yet", or "… · was due to leave 15 Sept 2026, 3
days ago" with a **Confirm departure** badge — the grid's name for that state.
`formatDay()` in `lib/api.ts` is the portal's date format (`en-IN`, read in UTC);
Chromium prints September as "Sept", which the portal already did.

### M5 — the grid's "Owes money" filter

A chip after the status chips — "Owes money 3 · ₹40,500" — filters to every bed
with a negative balance, whatever its status. The status precedence stays as
it is for the tile's colour; only the filter stops inheriting it. On the
screenshot seed, Overdue reads 0 while Owes money finds three tenants, and its
total equals the dashboard's Overdue tile.

### Verification

Four new e2e files — `bed-label`, `bed-picker-loading`, `vacating-dates` (375
and 768×1024), `owes-money-filter` (1024×768) — all with touch emulation. Each
was also run against the unfixed frontend first: 8 of 9 fail there, and the
ninth is the guard that "No sites yet" still shows when there are none. Full e2e
**103/103**, frontend unit 43/43, `go test ./...` passes. Screens checked at
375×812, 768×1024 and 1024×768.

---

## Audit round four — touch targets, M6, M10, M12 ✅ (Sep 2026)

Branch `audit-round-four`. **Migration 009** (`payments.rejected_at`,
`rejection_reason`) — run it on production before merging. The last round
before the real data import; what is left in the audit list can land after it.

### Touch targets — 44px under a finger, compact under a mouse

`components/ui/touch.ts` holds two recipes, both keyed on `pointer-coarse:` —
never width, for the reason `HOVER_REVEAL` gives. `TOUCH_TARGET` (min 44×44) is
in Button, Input, Select, SegmentedControl, the overlay Close button and the
clickable status pills; `TOUCH_LINK` makes a standalone text link 44px tall and
takes the growth back out with a negative margin, so a breadcrumb's line does
not move. The rest were hand-rolled in one place each and fixed there: the
grid's All / Owes money chips, the Pending tabs, room rename/delete (now with a
gap between them), bed-chip icons, the site delete, the account menu, sidebar
links, dashboard rows, checkbox labels, and the portal's header and forms (the
portal's raw `<input>`s and buttons moved onto the shared components).

The three stay actions on the tenant page were 16px text links in the header's
corner. They are a row of buttons now — Record notice on the left, "End without
settling" and "Settle & vacate" apart on the right.

`touch-targets.test.ts` walks every owner screen plus the portal at 768×1024,
1024×768 and 375×812 with touch, opening a room, a bed drawer, a ledger and the
payment forms, and lists every control under 44px. Its first run listed 120.
Inline links inside a sentence are exempt (WCAG 2.5.8); checkboxes are measured
by their label.

### M6 — rejecting a proof keeps it

`POST /api/payments/:id/reject {reason}` sets `rejected_at` and an optional
reason (300 characters) instead of deleting. Pending is now
`is_approved = false AND rejected_at IS NULL`, in `ListPending` and the
dashboard count; every money sum already asked `is_approved = true`, so nothing
else moved. Only a waiting proof can be rejected — an approved payment is 409,
because turning counted money into a rejection would change balances with
nothing on the record; that is what delete is for. Approve clears a rejection,
so a changed mind is possible from the API (no screen yet).

The Pending page asks for the reason in a dialog. `components/PaymentStatus.tsx`
gives both sides the same words: "Not accepted" with the reason, "Awaiting
approval" (owner) / "Pending" (tenant), and "Confirmed" on the tenant's side.
The owner's ledgers used to show a waiting proof exactly like counted money.

### M12 — moved out, still owes

`settledOwed(refund, paidAfter)` is the rule: a settlement's shortfall, less
anything approved on the stay whose `created_at` is after the settlement's.
Created-at rather than payment date, because a late-entered receipt is still
money that arrived after the agreement; the settlement row itself is never
rewritten. `loadMovedOut` feeds Collections (rows with `moved_out: true`, after
the active ones) and the dashboard (`moved_out_owed`, inside `overdue_amount`,
so the tile still equals Collections — it adds "incl. ₹X from tenants who moved
out"). The tenant summary uses the same rule, which fixed a quieter bug: it read
the refund alone, so a tenant who paid off their shortfall still showed it owed.

Only **settled** stays. An ended, unsettled stay has no agreed figure — its
deposit may cover the rent — and importing past tenants would otherwise fill
the list with guesses. Collections shows the group as "Moved out — still owes",
with "was in Room · Bed", "left 18 Sept 2026", "settled N days ago", and a
nudge about what is outstanding rather than rent on a room they left.

### M10 — a session that ends mid-form

`request()` turns any owner 401 under `/api/` into `OWNER_SESSION_ENDED` on
`window` and a message that says what happened ("You were signed out … what you
typed is still here"). Safe to treat every such 401 as the session: a wrong
current password on change-password is a 400, and login lives under `/auth/`.
The signed-in layout opens a sign-in-again dialog (same email, password only)
over the page, so the form underneath is never unmounted; "Use another account"
goes to `/login?next=`. A cold load with no session also goes to
`/login?next=<path>` (not for `/dashboard`, and not after a chosen sign-out),
and both the login form and the auth layout's own redirect follow it through
`safeNext`, which accepts only a path on this site. Modal and Drawer now name
their dialog by its title (`aria-labelledby`) — they were announced as a bare
"dialog".

### Verification

New: `touch-targets` (three sizes), `reject-proof`, `moved-out-owes`,
`session-ended` (4 cases, including `next=//evil.example`); Go unit tests for
`settledOwed`, `buildMovedOut`, `movedOutTotal` and the summary's paid-after
case; unit tests for the moved-out nudge. Full e2e, `go test ./...` and the
unit suite — figures in the PR. Screens checked at 375×812, 768×1024 and
1024×768 with touch, and 1280×800 with a mouse to confirm the compact layout.

### Decided, not built — before the import

All three were settled on 23 Sep 2026; see "Pre-import hardening" below.

- ~~**Aadhaar: last four digits only**~~ **reversed: keep the number.** The
  card image shows all twelve digits anyway. The images were the exposure.
- ~~**ID images at permanent public URLs: parked**~~ **done:** private
  uploads, migration 010.
- ~~**`DATABASE_URL` → direct endpoint: not yet verified**~~ **confirmed fixed**
  by the owner.

---

## Pre-import hardening — private uploads, required ID, login limits ✅ (Sep 2026)

Branch `pre-import-hardening`, **migration 010**, merged as PR #38 on 23 Sep 2026. The last session before the
real data import. The owner made the calls up front:
- **Aadhaar number:** kept as typed. The card image shows all twelve digits, so
  truncating the number protects nothing while the image exists.
- **ID images:** made private now, while production has no real tenants.
- **ID front:** required on public registration, not on the owner's form.
- **Rate limits:** added.
- **Corrections, waivers and rent changes:** deferred to a dedicated session.
  Their requirements are in `docs/BACKLOG.md` → "Nothing can be corrected,
  anywhere".

### Private uploads (migration 010)

`storage.Service` now has `Upload(...) error` and `SignedURL(key, ttl)`. The
upload endpoints return `{"key"}`, not a URL. The five file columns
(`tenants.{photo,id_proof,id_proof_front,id_proof_back}_url`,
`payments.proof_url`) hold keys, and every handler that returns a tenant or a
payment swaps them for a presigned link on the way out: `signTenant` and
`signPayment` in `handlers/files.go`. Links live an hour. That is long enough
for a tab left open, and short enough that a leaked link is dead before anyone
finds it.

Decisions worth keeping:
- **The column names still end in `_url`.** Renaming five columns touches
  every query and the API for no behaviour change. The API still returns a URL
  in those fields, just a signed one.
- **Reads accept an old full URL as well as a key** (`storage.KeyFromStored`).
  So deploy and migration can go in either order, and a value that is neither
  is *dropped*, not passed to a browser.
- **Writes accept keys only** (`storage.ValidKey`: `^(public|tenant)/<32
  hex>.<jpg|png|webp|pdf>$`). This closes the old extension-only check, which
  let any host's `.jpg` be stored. The owner's create-tenant path had no check
  at all and has one now.
- **`LocalStorage` links never expire.** Only R2 links do. The expiry is covered
  by `TestS3SignedURL_Expires`, which presigns offline and reads
  `X-Amz-Expires`.
- **`storage-check` now proves privacy rather than asserting it.** It fetches
  the signed link (expects 200), and with `--public-url` it fetches the plain
  address (expects a failure).

**Production, 23 Sep 2026 — done and verified.** The owner ran migration 010 on
Neon after the merge and disabled the R2 Public Development URL. Then
`storage-check --public-url` against production printed:

```
OK: signed link opens the file
OK: plain link refused (401) — the bucket is private
```

The runbook is in `docs/DEPLOYMENT.md` → "Private uploads". The in-app check
(open a tenant with a photo and see it load through a signed link) had not been
reported when this was written.

### ID front required at registration

`PublicRegister` returns 400 "Add a photo of the front of your ID." without
one. The form marks the field required, so the browser stops the submit at the
field itself, and a JS check runs before any upload starts. The owner's
new-tenant form is unchanged, because the owner may have a paper copy.
API-level e2e setup uses `TEST_ID_KEY` (a well-formed key with no file behind
it), because a real upload per test would spend the per-IP upload budget the
whole suite shares.

### Login and registration limits

In `middleware/login_limit.go`:
- **Logins:** ten *failed* attempts per IP, then one a minute. Only a 401 costs
  a token, so one hostel Wi-Fi full of correct logins never trips it. Owner and
  tenant logins have separate budgets.
- **Registration:** twenty per IP *per hostel*, then one every three minutes.

Deliberately not built: a per-account budget, and throttling on `/auth/signup`.

### Verification

`go test ./...` (new: `login_limit_test.go`, `storage_test.go`,
`files_test.go`), frontend unit tests, and the full e2e suite. Migration 010
was run locally against the dev database: 11 stored URLs became keys, and one
deliberately foreign URL from the audit was left in place and is dropped on
read.

**Found on the way:** the tenant profile's "Front"/"Back" ID links were 16px
tall, a miss from audit round four's touch-target pass. `touch-targets.test.ts`
could never see them, because no test tenant had an ID until registration
required one. They use `TOUCH_LINK` now. Test fixtures that leave optional
fields empty hide whatever renders only when those fields are filled.

---

## Rent from a date, delete tenant, smaller photos ✅ (Oct 2026)

Branch `rent-from-a-date`, **migration 011**. Prompted by a live walkthrough of
the production account on 21 Oct 2026, a month after pre-import hardening. That
walkthrough was read-only, and found the app working with no blocker. The
account still held September's two test tenants, and the real import had not
started. The owner asked for four things.

### Rent from a date (migration 011)

The owner: a long stay's rent "may eventually get bumped, it shouldn't affect
earlier [months]... The default behaviour should always be just to change the
price [from then on]", with whole-stay correction still available "although not
at the cost of poor UX".

- **`stay_rent_changes`** holds `(stay_id, effective_date, rent_amount)`. Rows
  exist only once a stay's rent has changed, and the first change writes two:
  the original rent from the start date, then the new one. A stay with no rows
  bills flat at `stays.rent_amount`, exactly as before. `stays.rent_amount`
  tracks the latest scheduled rent, so screens that only *show* the rent needed
  no change.
- **A step applies to every cycle that begins on or after its date.** A
  mid-cycle date never splits a cycle; it starts with the next due date.
- **`rentSchedule`** (`handlers/rent.go`) replaced `rent × cycles` at all six
  sites: dashboard, grid, Collections, Insights, tenant summary and
  settlements. Its single-step path *is* the old multiplication, so no existing
  test needed a new expected value. The grid's partial-vs-overdue threshold
  uses the rent of the cycle being billed now, not the move-in rent.
- **Two endpoints, two meanings.** `POST /api/stays/:id/rent-changes` sets a
  rent from a date; it refuses a date on or before move-in, and refuses a
  settled stay (409). `PUT /api/stays/:id` with a *different* `rent_amount` is
  the typo fix: it discards the schedule and bills the whole stay at the new
  figure. An unchanged `rent_amount` sent alongside other fields leaves the
  schedule alone, so a form that re-sends everything cannot wipe it by accident.
- **UI:** "Change rent" on each active stay opens `ChangeRentDialog`. The date is
  pre-filled with the next due date (`lib/rent.ts`, which mirrors the backend's
  `cycleStart`), and the dialog says which payment the new rent starts with.
  "Correct the whole stay instead" is a link under the form, not a second
  button. The stay card shows the history: "₹5,000/monthly → ₹5,500 from 6 Nov
  2026".

**Found while building it:** no screen could edit rent at all. Only the API
could, so the earlier "never edit the rent on a stay with payments" warning
covered nothing the owner could tap. The real gap was the missing capability.

### Delete tenant

`DELETE /api/tenants/:id`, owner-scoped. Stays, payments and settlements go
with the tenant by cascade, and the bed becomes vacant. The button is at the
foot of the tenant page with a short explanation. The confirmation counts what
goes ("1 stay, 1 payment (₹2,500 received)") before offering the button, and
says to end the stay instead for someone who simply left. Uploaded files stay
in R2 (BACKLOG).

### Photos shrink before upload

`lib/shrinkImage.ts`, called once in `uploadFile`, re-encodes JPEG, PNG and
WebP to JPEG at 1600px on the long edge, with EXIF rotation applied. It skips
anything already small, and falls back to the original (and reports why) if
decoding fails. Built on the browser's canvas, so no new dependency. The
original 3024×4032 photo on production was about 3 MB; a 1600px JPEG is a few
hundred KB.

### Registration names the hostel

`GET /public/owners/:id` returns the site's name when the owner has exactly
one site ("Register with Chopra Boys Hostel"), and the owner's name otherwise.
The response is still `{name}` and nothing else.

### Verification

New Go tests in `rent_test.go`, with exact values on one fixture (₹5,000 from
6 Jun, ₹5,500 from 6 Sep, seen on 21 Oct): billed ₹26,000, not ₹27,500;
mid-cycle dates; two changes; `paidThrough`; settlement dues; Collections'
days overdue; the dashboard's expected-this-month; tenant summary; Insights
per month; partial-vs-overdue. New frontend unit tests: `rent.test.ts` and
`image-size.test.ts`. New e2e tests: `change-rent.test.ts` (4),
`delete-tenant.test.ts` (2), and registration (hostel name, a 3024×4032 upload
arriving as 1200×1600). Plus the full suite.

**Production, 21 Oct 2026 — done.** The owner ran migration 011 on Neon, and
PR #39 was merged as `b8a170d`. The new backend was live about 75 seconds
later. Every screen that reads `stay_rent_changes` (dashboard, Collections,
grid, Insights, tenant summaries) returned 200, with the same figures as
before the deploy, and the new tenant-page controls appeared on Vercel.
**The owner started using the app for real the same day.**

---

## Tenant notes, and importing the notebook (Oct 2026)

The owner began backfilling production from the paper notebook: 16 people
across 15 entries, each with a move-in date, a room, a rent, a deposit, one or
two phone numbers, usually an Aadhaar, and a line about where they work or
study. Almost everything had a field already. The import needed one small
feature and one fix, and the old importer was broken.

### Notes (migration 012)

`tenants.notes`, free text, owner-only. The notebook holds things no field
does: "2-month course", "so-and-so is the reference contact", "entered 13
Oct, rent from 20 Oct". The owner wanted general notes rather than a
college-or-office field, and chose to **keep Workplace / College as its own
one-liner** next to a new Notes box. The one-liner is what the public
registration form asks a stranger and what the pending queue shows, so folding
it into the notes would have mixed a tenant's own answer into the owner's
private text.

Owner-only by construction. The portal's tenant queries (`tenant_auth.go`)
name their columns and leave `notes` out, and `publicRegisterRequest` has no
field for it. Both are pinned by tests. The form says so under the box: "Only
you see this. Tenants never do."

**Fixed on the way:** the profile showed an emergency contact only when it had
a *name*. Eight of these tenants have only a second number, so it would never
have appeared. It now shows whichever parts exist.

### The import script

`scripts/import-notebook.py` (`make import-notebook[-dry] FILE=…`). It goes
through the API as the owner, so it can only enter what the forms could. The
data lives under `.hostel-import/`, which git ignores: real names, phones and
Aadhaar numbers, in a public repo. **This log, the tests and commit messages
name no real tenant either.** Describe them by situation, never by name or
number.

- **Payments are derived, not listed.** The owner's instruction was "assume
  paid as of today". So each rent cycle that began on or before `as_of` gets
  one cash payment, dated the day it fell due, and each deposit gets one dated
  the move-in day unless the entry says `"deposit_paid": false`. The dates
  mirror `cycleStart` and `rentSchedule`, so a month-end move-in clamps, and a
  rent change (one tenant paid a lower first month, then more from the second) goes through
  `POST /stays/:id/rent-changes`. It never writes one stay at the later rent.
- **Every check runs before the first write:** phone and Aadhaar shape,
  duplicate phones or beds, each room and bed exists and is empty, and no phone
  is already on the account. It asks `yes` before writing.
- **It reads everything back.** A field the server dropped stops the run.
  That check caught exactly that in rehearsal, before migration 012 existed.
  Rent paid, balance and deposit held must match the plan.
- **Re-running skips phones already on the account**, so a fixed file adds
  only what is missing.

Entry date ≠ billing date came up for one tenant (entered 13 Oct, rent from
20 Oct). A stay has one date, and it drives both. It is set to the billing date
and the entry date is kept in the notes. Worth a field only if early arrivals
become common.

### The old importer is gone

`backend/cmd/import` (with `docs/import-prompt.md` and `make import-data`)
wrote straight to the database, which would need `NEON_URL` on this machine.
Its stay insert had also been broken since migration 004: it named 8 columns
and supplied 7 values, left over from `rent_due_day`. It also knew nothing of
deposits as their own payment kind, of rent changes or of expected end dates.
Deleted rather than fixed: two importers would drift, and the API path
inherits every rule the handlers already enforce.

### Verification

New e2e test `owner/tenant-notes.test.ts` (4 tests): write, show, edit and
clear on the forms; never returned at tenant login or `/tenant/me`; not
writable through public registration; an unnamed emergency number shows on
the profile. Plus the full suite.

**Full rehearsal on a local copy** (`seed-chopra.py` into a local owner, then
the import): 16 created, 16 read back as planned. The grid showed 15 paid and
one bed orange (leaving 1 Nov), with 16 of 45 beds occupied. Collections was
empty and overdue was ₹0. October's expected rent was ₹75,000, which matches a
hand sum. A second run created nothing.

**Production, 21 Oct 2026: done.** The owner ran migration 012 on Neon, and
PR #40 was merged as `919ccc2`. Render reported the backend deploy successful
at 09:21 UTC. The owner then ran the dry run and the import against the real
account and reported all 16 imported. That is the notebook's first batch.

**Still to come**, in later batches with the same script and a new file under
`.hostel-import/`:
- **More current tenants.** This batch was "a start".
- **People who left in between.** The script only creates open stays today.
  A past tenant needs an `end_date` (and probably a settlement) the script
  does not write yet. Add that when the batch arrives, and remember that
  Collections deliberately leaves unsettled ended stays out.
- **Bed placements.** The notebook names rooms, not beds, so this batch filled
  lower bunks first in move-in order. The owner will correct them in the app.

---

## Rent and all money: Insights becomes a table (Oct 2026)

The owner's report, after a week of real use: recording a deposit on a tenant
page did not move "Total paid", and nothing anywhere showed the money that had
come in. He checks each month against the bank and the cash drawer together,
so he needs rent *and* deposits in, less refunds out. A month with two
departures and no arrivals goes negative, and should. He also disliked the
Insights bar chart: every number was behind a hover the iPad does not have.

### Two questions, one loader (`handlers/money.go`)

- **Rent:** rent collected against rent billed, unchanged in spirit. A deposit
  still never counts here. What is new is that a settlement counts on the day
  the tenant left. Rent a held deposit paid off is collected
  (`settlementRent`: all the dues when the deposit covered them, the whole
  deposit when it did not), and rent paid ahead and handed back is
  subtracted.
- **All money:** every approved payment of either kind, cash and online, less
  each refund handed back at settlement. `netIn` may be negative.

A settlement has no date of its own (`created_at` is when it was typed), so
its money is dated on the stay's `end_date`. `loadMoneyByMonth` serves both
Insights and the dashboard tile, so the tile is the table's last row by
construction rather than by a test that compares two queries.
`loadDepositsHeld` is approved deposit payments on stays with no settlement:
money owed back at move-out.

### Insights

A Rent / All money switch, remembered per device (localStorage, read after
mount, and every access in try/catch). Three tiles per view:
- **Rent:** rent collected and % of billed; still owed now (the dashboard's
  own figure, fetched, linking to Collections); occupancy this month.
- **All money:** net in; deposits in, with refunds beside them; deposits held
  now.

Below the tiles, one row per month, newest first. Months before the first
tenant are dropped, and quiet months after that stay. Tapping a month calls
`GET /api/insights/months/:month`, which lists each payment and each effect of
a settlement as a line. Amounts are always positive, the kind says the
direction, and each view lists only its own kinds, so the lines add up to the
row (pinned in `money_test.go`). On a phone, the money view folds rent,
deposits and returned into a small line under "Net in" rather than scrolling
sideways. The collected bar chart is gone, and with it the iPad left-drift
bug (BACKLOG).

**After the owner saw it on demo data:**
- **The occupancy chart went too.** It had the same left-drift and the same
  hover problem, and "Occupancy this month" is already a tile. With it,
  `components/ui/Chart.tsx` was deleted: nothing draws a chart now, and
  `Meter` moved to its own file. CLAUDE.md's chart rule now says "prefer a
  table".
- **A busy month** leads with a totals strip by kind ("Rent ×45 ₹2,40,000 ·
  Returned ×2 −₹30,900"), lists its lines newest first whatever their kind,
  shows ten until "Show all N lines", and has a "Close" button at the foot
  that scrolls the month back into view. Grouping deposits and refunds ahead
  of rent shipped in #41 and read as out of order to the owner, so it was
  removed (`insights-fixes`).
- **Remembered range, fixed** (`insights-fixes`). On return, "1m" was pressed
  over twelve months of figures. The page loaded the default and the saved
  range one after the other, and the slower answer won. Now nothing loads
  until the saved range is read, and an answer that arrives after a newer
  request is dropped. The test delays a 6m answer past a tap on 1m.
- **Range** gained 1m ("this month so far", so the tiles answer the
  bank-statement question directly) and is remembered per device like the
  view.
- **"Deposits in" became "Deposits, net"** (`net-deposits`). A month where
  people only left read "₹0" while ₹30,900 of deposits went back. The tile is
  now deposits in less the *deposit part* of refunds (`deposit_returned_paise`:
  a refund less any rent paid ahead in it), signed and red when negative, with
  "₹X in · ₹Y back" under it.
- **"Advance returned" became "Rent refunded"**, in the Rent view and on the
  tenant page's settlement card. It is rent paid for time not lived, handed
  back at move-out. The settlement drawer keeps "paid in advance", where it
  describes the choice being made.

### Elsewhere

- **Tenant page:** "Total paid" is now "Rent paid", with "+ ₹2,000 deposit
  held" or "deposit ₹2,000 not yet paid" under it (`deposit_held` and
  `deposit_due` on the summary).
- **Dashboard:** the Collected tile adds one line, "All money in: ₹X", when a
  deposit came in or went out this month. A first version listed deposits and
  refunds separately and wrapped to four lines on an iPad in landscape, which
  is the clutter the owner keeps flagging.

**Found and left:** the dashboard's "expected this month" counts open stays
only, so a tenant who leaves mid-month drops out of it, while Insights keeps
their billed rent. Once leavers are settled the tile can read over 100%.
Logged in BACKLOG. It shares a query with overdue, which must stay open-only.

### Verification

`money_test.go` uses three October leavers with exact values: short (the
deposit pays ₹2,000 of ₹4,500), charged (₹500 kept, ₹1,500 back) and ahead
(₹5,500 advance plus the deposit back). Rent collected comes to ₹67,000, net
in to ₹65,500, and a refund-only month goes negative. The lines add up to the
month, and the tenant summary's held and due figures are checked too.

`insights.test.ts` was rewritten (9 tests). Four tenants make a current month
with every kind of money in it: billed ₹23,000, rent ₹21,000 (91%), net
₹17,000, held ₹3,500. It covers the view remembered across a reload, the
dashboard tile, the tenant tile, and the table fitting 375, 768 and 1024px
without scrolling sideways. Checked by eye on the rehearsal copy at all three
sizes.

**Production, 21 Oct 2026: live.** PR #41 was merged as `81c8284`. The
owner checked Insights on his real account and found the remembered-range bug
and the grouping he did not want. Both were fixed in PR #42 (`580d3c4`), and
Vercel reported the production deploy successful.

---

## When rent is due (Oct 2026)

The owner wanted to see at a glance when each tenant's rent is due. Billing
has always run on the stay's anchor day (`cycleStart`), but nothing said what
that was.

**`handlers/due.go` → `dueFor`** returns one stay's next due rent: the start
of the oldest cycle not fully paid (from `paidThrough`, the rule Collections
uses), what is still owed on it, and a state:
- `overdue`: behind; the date is when they fell behind.
- `due_today`: a cycle began today and is unpaid.
- `upcoming`: square; the date is the next due day.
- `paid_ahead`: nothing due until the date.

The grid's beds and the tenant summary (open stay only) carry
`due_date`/`due_paise`/`due_state`. The date is a calendar string, so no
timezone moves it. `lib/due.ts` only words it.

What the owner sees:
- **Bed panel and tenant page:** one line under the balance:
  - "Next rent ₹6,000 due 31 Oct"
  - "Overdue since 15 Oct" (red)
  - "Rent ₹5,500 due today"
  - "Paid up to 15 Jan"
- **Grid tiles:** a date only when it needs acting on: "due 15 Oct" in red
  under the amount owed, or "due 24 Oct" / "due today" in amber within 7
  days. Paid-ahead and later dates stay quiet.

He shaped it before it was built: red tiles get the date too, the line lost a
redundant "every month on the 31st", and the "Due this week" dashboard list
waits to be designed with quicker payment recording.

### Verification

- `due_test.go`: exact dates for square, one month behind, part of a month
  paid, due today, paid three months ahead, a 31 Aug move-in across
  September, after a mid-stay rent change, and moving in next month. The
  summary reports the open stay's due rent and nothing when no stay is open.
- `tests/unit/due.test.ts` covers the wording and the 7-day tile window.
- `owner/rent-due.test.ts` (2 tests): behind, soon and paid-ahead tenants on
  the grid, the bed panel and the tenant page.
- Checked by eye on the local demo at iPad portrait. The pane misplaces
  slide-in panels at tablet sizes (known), so the panel was read from the page
  and screenshotted at desktop width.

**Production, 21 Oct 2026: live.** PR #43 was merged as `e438f3d`, and
Vercel and Render both reported their deploys successful at 13:53 UTC. No
migration.

**Next:** "Due this week" and quicker payment recording, designed together at
his request; see "Payments" below.

---

## Payments: due this week, recorded in a few taps (Oct 2026)

Recording a payment, the thing the owner does most, was three screens deep
for anyone paying on time: Collections listed only people who owed, so a
tenant paying on their due day had no row. Payments arrive at all hours, by
UPI at the reception's code or cash in hand, and his mother enters them when
she visits, from memory. The screen is built for that.

**Collections is now Payments** (`/payments`). "Collections" did not say what
it held to someone seeing it cold. The old page, its `/api/collections`
endpoint and its client are gone, with no redirect: nobody had bookmarked it
yet. In order:
- **"Who paid?"** search, by name or room, over every open stay, for anyone
  not on the lists (paying early, a second month).
- A banner when tenants have sent payment proofs from the portal, linking to
  Pending's proofs tab (`/pending?tab=payments`).
- **Overdue**, oldest first: amount owed, "Overdue since 15 Oct", Nudge.
- **Due this week**: due today or within 7 days (`dueSoon`, the same window
  as the grid's amber tiles), "Due Sat, 25 Oct". No nudge, since nothing is
  owed yet.
- **Recorded this week**: payments *entered* in the last 7 days, with how and
  when they were paid, latest paid first. It answers "did I already put that
  in?". Ordered by entry time at first, a batch typed in one sitting looked
  shuffled, since each line shows the date paid.
- **Moved out — still owes**, unchanged but folded.

Each of the two lists shows 5 rows, with its count in the heading and "Show
all N" beneath, so a long Overdue list cannot push Due this week off the
screen. He asked for each list in its own scroll box; we chose this instead,
because a scroll area inside a scrolling page traps the finger on an iPad and
hides that there is more. An empty list is left out, and the subtitle says
so: "Nobody overdue · 3 due this week", or "2 overdue · none due this week".
With nothing due at all, one card says "Nobody is due this week".

Recording opens in the row with everything prefilled: what they owe (or the
rent coming due), Cash or UPI as they paid last time, and **Today** /
**Yesterday** / **Another day** as taps, since entries are often a day late.
The note hides behind "+ Note". The button says the amount ("Save ₹7,000").
After saving, the row moves to Recorded and the next one is right there.

**"Online" is "UPI" everywhere** the owner sees it: every record form (all
three now use the same Cash / UPI buttons), the dashboard, the tenant ledger,
the bed panel and Insights. Labels come from `lib/payMethod.ts`; the stored
value is still `online`, so nothing recorded changed.

The dashboard's "Needs attention" gains "N tenants due to pay this week",
linking to Payments; the list lives in one place. The nav's red count is now
who is behind (overdue or moved out owing), not who is due today.

**Backend:** `GET /api/payments/board` (`collections.go` → `GetBoard`) sends
every open stay as a `CollectionRow` (built by `payeeRow`) with
`due_date`/`due_paise`/`due_state` from `dueFor` and `last_payment_type`,
plus the moved-out rows, payments entered in the last 7 days, and the
pending-proof count. It replaces `GET /api/collections`.

**Fixed on the way:** a rent-free bed read as "overdue since move-in" on ₹0
(since #43: a red date on its grid tile, and it would have topped Overdue).
`dueFor` now returns nothing due when the rent at the due date is zero, and
the grid, tenant summary and board send no due fields for it.

Left out at his call, to build later: deposits still owed as rows, an undo on
recorded payments, and any new work on the moved-out section.

### Verification

- `TestBuildPayees_SoonestDueFirst`: behind, due soon and paid-ahead stays
  in that order, with exact dates, amounts, days and last payment type. The
  old `buildCollections` tests now run against `payeeRow`, and `TestDueFor`
  covers the rent-free bed.
- `tests/unit/due.test.ts`: the 7-day window (today counts, day 8 does not,
  overdue never), weekday wording, and the UPI label.
- `owner/payments.test.ts` (7 tests). At iPad portrait with touch: nobody
  overdue, nothing due this week, nobody due at all (search and recording
  still work), and eight overdue, where five show, Due this week starts on
  the first screen, Show all / Show fewer work, and recording one brings the
  sixth up. Also: the two lists and what is on neither;
  recording a due-this-week payment as UPI dated yesterday, checked in the
  API, and "Recorded this week" in paid-date order; search by name and room,
  with a note; the proof banner opening Pending on its proofs tab, and the
  dashboard line. Four tests that read `/api/collections` now read the board.
- `collections.test.ts`, `moved-out-owes.test.ts`, `touch-targets.test.ts`,
  `responsive.test.ts`, `account.test.ts` and `session-ended.test.ts` moved
  to the new name and buttons.
- Checked by eye on the local demo at 768×1024, 1024×768 and 375×812. On a
  phone the amount and buttons wrap under the name.
- The touch-target test caught the proof banner at 40px; a linked `Banner`
  now carries `TOUCH_TARGET` everywhere.
- Full suite: 141 e2e and 59 unit tests pass, plus `go test ./...`.

**Production, 22 Oct 2026: live.** PR #45 was merged as `bb4a901`, and
Vercel and Render both reported their deploys successful at 09:58 UTC.
`/payments` serves and `/collections` is gone (404). No migration.

**Next:** the rest of `docs/BACKLOG.md` → "round two", one at a time, in the
owner's order.

---

## Moving out: one sheet, the house rules, and the owner's last word (Oct 2026)

The owner found moving someone out hard to follow, and expected someone who
is not an engineer to find it harder. Five controls each did part of it:
- Record / Update notice
- "End without settling" and "Settle & vacate", side by side as equals
- "Settle deposit" for a stay that ended unsettled
- the grid's "End stay", which freed the bed and never touched the money

The settle drawer read: date, a sum, an advance dropdown, "Adjustments"
(Deduct / Add back), then the answer.

What he does at the door, in his words: they gave notice, they are leaving
today, take off anything, hand back the rest. His rules, given before the
build:
- Rent is never refunded.
- The deposit comes back only to someone who gave notice. Notice is expected
  by the time they pay their last month's rent, and the rule isn't strict.
- He usually takes nothing off.
- He has the last word on every one of these.

**`MoveOutSheet`** (`components/MoveOutSheet.tsx`) is now the only way out,
labelled "Move out" on the tenant page and in the grid's bed panel. It reads
"Settle the money" on a stay that ended with the money left for later. Top to
bottom:
1. **Leaving on**: Today, the date their notice gave (once it has passed), or
   another day.
2. **Deposit**: one line saying why, then Give it back / Keep it.
   - "Gave notice 1 Oct, in time."
   - "Gave notice 12 Oct, less than a month before leaving (due by 1 Oct)."
     The deposit still comes back by default; the line is there so he can
     decide.
   - "No notice given, so the deposit is kept by default." A **They gave
     notice** link records a notice nobody wrote down, and the deposit comes
     back.
3. **The money**, as a sum:
   - deposit held
   - rent still owed, with "how?" for the working
   - "Deposit kept: no notice", when kept
   - rent paid for after they leave, marked as kept
   - anything taken off
4. **Hand back** (or "*Name* owes you"): a box he can type into. A typed
   amount is recorded as a "Changed by you" line for the difference, so the
   settlement still adds up.
5. **Paid back by** Cash / UPI, when something is handed back.

A quiet link at the bottom, "They've left · settle the money later", ends the
stay without the money.

The house rules are one pure function, `moveOutSettlement` (`lib/settlement.ts`):
- The deposit kept is `max(0, deposit − rent owed)`, so a tenant who owes more
  than the deposit still owes the difference.
- `advance_returned_paise` is always sent as 0.
- The server checks the sum as before; nothing about it changed.

**Leaving on the rent day no longer starts a new month.** It used to: rent on
the 23rd, leaving on the 23rd, billed a whole month they would never live, and
the demo showed it. The owner's rule is that their last paid month covers
them up to that day. `cyclesThroughEnd` (`helpers.go`) bills every cycle that
began *before* the leaving day, and at least one. Everything that bills an
ended stay goes through it:
- the settlement, via `duesForSchedule`
- the notice deadline, via `noticeBy`
- the tenant summary
- Insights' `billedCycles`

So the three money views cannot disagree about a leaver. Open stays are
unchanged: rent is still due on the rent day.

**"They're staying"** now cancels the notice: both dates, in one tap. It used
to clear only the leaving date. A notice date alone keeps a bed "vacating", so
the bed stayed orange and the button looked dead. That was the "on the iPad"
bug, and it wasn't about the iPad.

**Backend:**
- **Migration 013:** `settlements.refund_method`, the `payment_type` enum,
  nullable. Settle accepts `refund_method` and keeps it only when something
  was handed back. Insights' month lines now say Cash or UPI on refunds.
- **The preview carries the notice:** `notice_date`, `expected_end_date`,
  `notice_by` (the start of the rent month they leave in, via `noticeBy`) and
  `notice_on_time`.
- **Removed:** `EndStayDialog` and `SettleStayDrawer`.

### Verification

- **Go:** `TestLeavingOnTheRentDay` covers the owner's example (rent and
  leaving on the 23rd), checked across the settlement, notice deadline,
  summary and Insights. Four older fixtures that left on a rent day were
  updated, each saying why. `TestNoticeOnTime` covers the rent day itself, the day after, the
  last week, never, and a 31st move-in. `TestRefundMethod` covers cash, UPI,
  not said, a kept deposit, an owing tenant and a bad value.
- **`tests/unit/settlement.test.ts`:** seven cases for the house rules:
  - square
  - owing
  - paid ahead
  - no notice
  - no notice and owing more than the deposit
  - a deduction
  - the owner's own amount
- **`owner/move-out.test.ts` (6 tests, iPad portrait with touch):**
  - notice in time, paid back in cash
  - no notice, kept, then ₹4,000 given back anyway by UPI (checks the stored
    lines)
  - recording a forgotten notice
  - late notice
  - rent paid ahead kept
  - from the grid: settle later, then "Settle the money" on the tenant page
  - leaving on their rent day owes nothing for the month starting then

  `insights.test.ts`'s two leavers now go on the 2nd, one night into the
  month, which keeps its figures. Those tests skip on the 1st, when the 2nd
  is still in the future.
- **Moved to the new sheet:** `settlement.test.ts`,
  `tenant-profile-enrichment.test.ts` and `vacating-notice.test.ts`. The
  last now runs on an iPad and checks both dates clear and the bed is no
  longer vacating.
- **Full suite:** 148 e2e and 66 unit tests, plus `go test ./...`.
- **By eye:** screenshots of the sheet at 768×1024 via Playwright on the demo
  (late notice; no notice with rent paid ahead). The Browser pane cuts
  slide-in panels off at that size.
- **Also fixed:** the Payments record form hand-rolled a card outline, which
  `grep ring-stone-200 src/app` now catches. It uses `Card`.


**Production, 23 Oct 2026: live.** The owner ran migration 013 on production
first. PR #46 was then merged as `3a2062f`, and Vercel and Render both
reported their deploys successful at 08:24 UTC. Settling a stay is the first
write to `refund_method`; the owner's first real move-out confirms it.
---

## Two quick fixes: tenant rows and wide amounts (Oct 2026)

**The whole tenant row opens the tenant.** Above `sm`, `/tenants` was a table
whose only link was "View →" at the far right. Now it's one list at every
width, each row a link: name, phone, email and since as columns from `sm` up,
and stacked on a phone, as before.

**Money tiles no longer spill on a phone.** The tenant page's Rent paid / Stay
duration / Balance tiles were three across at every width, and a third of
375px cannot hold "₹10,50,000". On a phone they are now two across, with
Balance on its own row.

### Verification

`owner/narrow-screens.test.ts` (6 tests) runs at 375×812, 768×1024 and
1024×768 with touch:
- **Wide figures:** a tenant with ten-lakh figures (₹10,50,000 rent paid,
  ₹2,10,000 owed, a ₹1,00,000 deposit). The tenant page, dashboard,
  Payments, Insights and Tenants are checked for anything spilling out of
  its box, or the page scrolling sideways.
- **Row taps:** tapping the phone number opens the tenant.
- **Calibrating the amounts:** at crore-sized figures (₹1,13,40,000) the
  dashboard's Overdue tile also spilled at 1024. That is beyond any
  45-bed figure, so the test uses the realistic ceiling.

Full suite: 154 e2e and 66 unit tests. Screenshots checked at 375 and 768 on
the demo.

**Production, 23 Oct 2026: live.** PR #47 was merged as `9f03ea0`, and
`/tenants` and `/dashboard` serve on production. Frontend only, no migration.

---

## Paid today, and bookings (Oct 2026)

Nearly every tenant pays the first rent, and usually the deposit, on the day
they move in. Some book instead: they pay something to hold a place (half the
rent, or just the deposit) and come back on the day they want, when they get a
bed and pay the rest. The forms took only the terms, so the money was a second
trip to the tenant page, and a booking had nowhere to go at all.

**Add tenant is shorter, and asks what's happening.** It reads top to bottom:
1. **Who:** name and phone.
2. **About them:** email, workplace, address and notes.
3. **ID and emergency contact:** Aadhaar, the emergency contact and their
   phone, then photo and ID front and back in one row.
4. **Their stay:** Moving in (the default), Booking, or Just add, with the money
   last, next to the button that saves it.

Only name and phone are required. The details were briefly folded away to
shorten the form, but the owner wants them filled in every time, and a folded
panel invites skipping them. The form is shorter in other ways instead:
- **Pairs on the iPad:** fields sit two or three across where there is room.
- **A bed dropdown:** it replaced a radio list that grew with every vacant bed.
  Assign bed uses it too.
- **A Monthly / Weekly / Daily switch:** it replaced the cycle dropdown, and
  sits beside the start date.
- **"Paid by" beside the amounts:** sized by its container, so it is three
  across on a page and two in a drawer.

At 768×1024 the form went from 1,941px to 1,419px with everything showing,
27% shorter.

**Paid today** (`PaidTodayFields`, `components/StayForm.tsx`) appears on
every form that puts someone in a bed: Add tenant, a vacant bed on the grid,
and approving a registration.
- **Filled in from the terms:** one rent period and the agreed deposit, each
  following the terms until typed over.
- **Cash / UPI**, and **"They haven't paid yet"**, which records nothing.
- **The button says the total:** "Add and move in · ₹16,000 paid".
- **Dated the start day** ("Paid on 18 Oct 2026"), or today for a future
  start, since a payment can't be dated ahead.
- Each amount is an ordinary payment, recorded after the stay is made. One that
  fails is named in a toast ("The deposit of ₹10,000 wasn't recorded. Record it
  from Payments.") rather than failing the form.

**A booking is a stay with no bed** and an arrival date. The owner promises a
place, not a particular bed, so nothing is held on the grid.
- **Made from** Add tenant → Booking, or approving a registration → "Approve
  & book a place". The form takes "Arriving on" and **Paid to book**, which
  suggests nothing and is dated today.
- **Until they arrive**, nothing is billed. What they paid counts towards their
  first month, and Payments shows what's left ("Booked, no bed yet", due on
  the arrival day), which reaches "Due this week" as the day nears.
- **The tenant page** shows "Booked · Arrives 1 Nov", and offers **Assign
  bed** and **Cancel booking** in place of Record notice and Move out.
- **Arriving:** Assign bed now has "Rent from", defaulting to the booked day
  and movable for an early or late arrival, and Paid today, filled in with
  what's still owed after what they paid to book.
- **Cancelling** uses the move-out sheet in a booking mode, with no leaving day
  or notice to ask about. By the house rules, the rent paid to book and the
  deposit are kept ("Deposit kept: booking cancelled"). The owner can type
  over the amount to hand any back, recorded as "Changed by you".

**What the backend does with a cancelled booking.** A stay that ends without
ever having a bed bills nothing: `endedCycles` (`helpers.go`), used by the
settlement, the tenant summary and Insights alike. A bed is never taken off a
stay once given, so no bed at the end means none ever. A booking cancelled
before its arrival day is dated the day it was cancelled, start and end
alike, and its opening rent step moves with it (`SettlementHandler.Create`).
No migration.

**Left for later**, at the owner's call:
- an "Arriving soon" list (he worried about crowding the screens)
- a "Leaving on" date when someone moves in

Both are in `docs/BACKLOG.md`.

### Verification

- `owner/paid-up-front.test.ts` (6 tests) covers each form recording both
  payments, typed-over amounts, "They haven't paid yet", and a backdated start.
- `owner/booking.test.ts` (5 tests) covers:
  - booking from Add tenant, with no bed and nothing billed
  - Assign bed taking the rest of the money
  - an early arrival moving "Rent from"
  - cancelling, which keeps what was paid and dates the stay today
  - the owner handing the booking money back
- **Go:** `TestCancelledBooking_BillsNothing`.
- **Unit:** the cancelled-booking settlement.
- **Updated** for the new form: `place-on-create`, `pending-terms`,
  `bed-label`, `bed-picker-loading`, `tenant-notes`, `tenant-management` and
  `session-ended`. `pending-terms` uses "They haven't paid yet" for its "no
  money" case.

All tests at iPad size use touch. Screenshots were checked on the demo at
768×1024.

Full suite: 165 e2e and 67 unit tests, plus `go test ./...`. Showing the bed
list by default exposed its rows as 36px under touch. They are now 44px
(`touch-targets`), which also helps Assign bed and the grid.

**Production, 23 Oct 2026: live.** PR #48 was merged as `8586d7a`, and
Vercel and Render both reported their deploys successful at 09:51 UTC.
`/tenants/new` serves and the backend's `/health` answers. No migration.

---

## Registration, in line with Add tenant (Oct 2026)

The QR registration form isn't in use yet. Before it goes on a sticker, both of
its halves were brought in line with what the owner side became in #48.

**What the tenant fills in** (`app/register/[ownerId]/page.tsx`) is grouped
like Add tenant:
1. **You:** name and phone.
2. **About you:** workplace and address.
3. **ID and emergency contact:** Aadhaar, the emergency contact and their
   phone, ID front and back, and a photo.
4. **Sign-in:** a password.

The labels are Add tenant's own. What changed:
- **No "(optional)" anywhere.** Beside most fields it read as permission to
  skip them. Only what is required is marked, with the asterisk.
- **The emergency contact is now required.** The owner asked for it, and the
  backend refuses a registration without it, as it does without the ID front.
  Owner-created tenants still need only name and phone.
- **No email field.** The owner dropped it; the API still accepts one.
- **Fewer hints.** Only the ones that change what someone types are left:
  "You'll sign in with this" under the phone, what counts as an ID, the
  password length, and "Only the owner sees this" beside the Aadhaar number,
  for trust.
- **The thank-you screen** no longer promises a bed, because a booking has none
  yet.
- **The heading is a welcome:** "Welcome to Chopra Boys Hostel" and "Fill in
  your details to get started", in place of "Register with …". The
  "Hostel Manager" line above it is gone, since a tenant has never heard of the
  app. An owner with no site, or several, gets plain "Welcome": the public
  endpoint returns an empty name instead of falling back to the owner's own.

**Approving a registration** (`/pending`) is one screen, laid out like Add
tenant:
- Their details and ID photos come first, then a Notes box (owner-only), then
  "Their stay" last.
- **The same three answers:** Moving in (the default), Booking or Just approve,
  on the same switch.
- **The same shared parts:** bed picker, terms, and Paid today or Paid to book.
  The drawer's own site and bed dropdowns are gone, and the rent fields show
  from the start.
- **A number already on your books** gets a warning on the queue and in the
  drawer: "Same number as Aditya Bose, already on your books". It links to
  their page. It warns, it doesn't block, because two people can share a
  phone.

**One save path.** `POST /api/tenants/:id/approve` only approves now, and takes
an optional note. Only a registration still waiting can be approved. It used to
make the stay too, from a bed and terms in its body, which was a second copy of
`POST /api/stays`. The drawer now approves, then makes the stay and records the
money with the same calls as Add tenant. If the stay fails, it says so, the
way Add tenant does. Tests and `seed-demo.py` approve and then make the stay
(`approveIntoStay` in `tests/e2e/helpers/api.ts`).

The arrival choice (`Arrival`, `arrivalOptions`, `ARRIVAL_HINT`) moved into
`components/StayForm.tsx`, shared by both screens.

**Left for later, by the owner's choice:**
- **A printable QR code.** The Pending panel still shows only the link.
- **An arrival date on the form.** It would need a migration.
- **The tenant saying what they've already paid.** Same reason; most people
  register at the desk, where the owner sees the money change hands.

### Verification

- **New:** `owner/pending-approval.test.ts` (3 tests) covers:
  - one screen, with the note saved and the stay made
  - nothing approved before the stay adds up
  - the same-number warning, phone typed differently
  - Just approve, which makes no stay, and a second approve, which gets a 404
- **Updated:**
  - `public/registration.test.ts`: the new labels and heading, plus two new tests, one for
    the required emergency contact and no email, and one for no "(optional)"
  - `pending-terms` and `paid-up-front`: the new drawer
  - `reject-proof`, `touch-targets`, `portal` and `tenant-profile-enrichment`:
    approve, then make the stay

Screenshots were checked on the demo at 375×812, and at 768×1024 and 1024×768
with touch.

Full suite: 170 e2e and 67 unit tests, plus `go test ./...`. Running the
registration tests back to back trips the public upload limit (10 per address),
so a rerun wants a fresh backend.

**Production, 24 Oct 2026: live.** PR #49 was merged as `828f906`, and
Vercel and Render both reported their deploys successful at 07:14 UTC.
`/register/4`, `/pending` and `/my/login` serve. The backend's `/health`
answers, and `/public/owners/4` names Chopra Boys Hostel. No migration.

## The tenant portal, and strict phone numbers (Oct 2026)

What a tenant sees after signing in at `/my` had been left alone since the
portal was first built. It showed their payments and nothing else, so a tenant
two months behind saw a green "Active" and a green "Confirmed".

**The portal** (`app/(tenant)/my/page.tsx`):
- **A money card at the top**, red or green:
  - "You owe ₹14,000", or "You're paid up".
  - When rent is due: "Rent due since 1 Sep", "Rent ₹7,000 due today" or
    "Next rent ₹7,000 due 1 Nov".
  - The deposit: "Deposit ₹14,000 not paid yet", "paid", or both halves.
  - Anything they sent that the owner hasn't confirmed: "₹7,000 you sent is
    waiting for the owner to confirm".

  The figures come from `GET /tenant/summary`, which is the owner's tenant
  summary (`loadTenantSummary`, pulled out of `Summary`). The e2e test checks
  the two responses are equal.
- **"Record a payment"** replaces "Submit payment", for cash or UPI. The
  tenant picks Cash or UPI, with nothing picked for them, and the
  screenshot field shows only for UPI. It fills in what they owe, and the
  form lost its "(optional)"s. Before this every tenant payment was saved as
  UPI whatever they had done, because the handler hard-coded `online`.
  - The backend refuses a payment with no method.
  - The owner's pending queue shows the method on each row ("Meera · ₹3,000
    · Cash"). Its tab is renamed from "Payment Proofs" to "Tenant payments",
    since a cash payment has no proof.
  - Every payment row in the portal shows its method beside the date,
    including the ones the owner records. Those show as Confirmed, as they
    always did.
- **Notice to vacate gets a panel of its own.** It was two lines of small
  print. Now it reads "You're leaving on 14 Nov 2026", with when notice was
  given and that rent runs until the owner confirms. Two buttons sit under it:
  - **Change date** (or **Add a date**) moves the leaving date. It keeps the
    original notice date, which decides whether the deposit comes back
    (`noticeBy`). It used to reset to the day of the change.
  - **Withdraw notice** asks first, then clears both dates
    (`DELETE /tenant/stays/:id/notice`), just like the owner's "They're
    staying". Notice given again later counts from that day.
- **Empty and failed are different answers:**
  - Approved with no stay yet (the owner chose "Just approve") reads "You're
    approved. Your room will show here once it's set up."
  - A failed load reads "Couldn't load your details", with Try again. It used
    to swallow the error and say "No stays found".
- **A booking reads as one:** "Booking", "You'll get a bed when you arrive",
  and a "Booked" badge, where it used to say " ·  · Unassigned".
- **The header names the hostel**, using the registration page's rule: the
  site's name when the owner has exactly one. It comes back on tenant sign-in
  and `/tenant/me` as `hostel_name`. Before sign-in it still says "My Portal".
- **Smaller wording:** "₹7,000 a month" (it read "/monthly"), "Living here",
  "Moved out", and "Payments".

**Phone numbers are checked strictly**, the same way everywhere (`phone.go`,
`lib/phone.ts`). A number must be an Indian mobile: ten digits starting 6–9.
Spaces, dashes, brackets, and a +91, 91 or 0 in front are allowed. The ten
digits are what gets stored. This applies to:
- public registration, for the tenant and the emergency contact
- Add tenant and editing a tenant
- owner sign-up, where the phone is optional
- tenant sign-in

All 31 numbers in the notebook import pass. Numbers already saved in another
shape stay as they are until someone edits that record.

**Tenant sign-in matches on the last ten digits** (`phoneDigitsSQL`), so
"+91 98450 12345" on file and "9845012345" at the sign-in box are the same
person. Where several records share a number, as with a returning tenant, each
is tried newest first and the password decides. It used to pick one at random.

**In passing:** the owner's tenant page balance tile never showed its red or
green tint, because the card's `bg-white` won. Both tiles now force the tint.

**Not built, on purpose:** the notice rule in the portal, a refund line after
moving out, a way to contact the owner, and tenants changing their own
password. **House rules on the registration form** are next
(`docs/BACKLOG.md`, round two).

No migration. Tests:
- `tenant/portal-money.test.ts` (13 tests)
- `tests/unit/phone.test.ts`
- `phone_test.go`
- Four existing test files had invented numbers like `5…` or `2…`. They
  now start 6–9.
- The Payments test for "Fix phone" needs a number that can't be saved any
  more, so it gets one by rewriting the board response, the way a record from
  before the rule would come back.

Full suite: 183 e2e and 70 unit tests, plus `go test ./...`.

**Production, 24 Oct 2026: live.** PR #50 was merged as `7c96254`. Vercel
and Render both reported their deploys successful at 08:46 UTC. A tenant
sign-in with "abc" now gets "Enter your 10-digit mobile number.", and the
live sign-in page's bundle has the same message. `/my/login`, `/my`,
`/pending` and `/register/4` serve, and `/public/owners/4` names Chopra Boys
Hostel. No migration.

---

## A site opens on its grid; no email; a loader for slow loads (Oct 2026)

Three things the owner noticed running the hostel on 24 Oct.

**A site opens on its grid.** Assigning beds is the everyday job and laying
out rooms is occasional, so every way into a site now lands on
`/sites/:id/grid`:
- the Sites list's cards ("Open →")
- the Sites tab, when the owner has exactly one site (`onlySiteId` in the
  dashboard layout)
- the dashboard's site cards, which already did

Room setup keeps its URL, `/sites/:id`, and is reached from an "Edit rooms"
button on the grid. Its old "← Manage rooms" read as a back button. There are
two ways back to the list, where a second site gets added: "Sites" in the
grid's breadcrumb, and the Sites tab once there are two. A site with no rooms
has nothing for the grid to show, so the grid sends it on to room setup.
Creating a site goes straight there too. Room setup hides "Back to the grid"
until there is a room, so the two pages can't bounce.

**The grid says who lives there:** "22 tenants · 23 beds free" under the
site's name. One tenant to a bed, so occupied beds are the headcount. A
booking with no bed isn't counted, and isn't on the grid either.

**The occupancy figures say which question they answer.** The dashboard's
49% and Insights' 43% looked like a contradiction. They are two questions:
beds full today, and the average night so far this month, which runs lower
while rooms fill up. The dashboard now says "49% full today", and Insights
says "average night so far, not today".

**Email is gone from every owner screen:**
- Add tenant
- Edit tenant
- the tenant page heading
- the Tenants list (its column and its search)
- the pending drawer
- the grid's quick-add form

Registration dropped it in #49. The column stays, and so does whatever is in
it (nothing, on production).

**`PageLoader`** (`components/ui/PageLoader.tsx`) replaces the full-page grey
bars and spinners: a 4×3 block of bed tiles in the grid's colours, popping in
and out.
- It is held at opacity 0 for 800ms, so a warm page, which loads well under a
  second, never shows it. The owner asked for exactly that: no loader on every
  transition.
- After 5 seconds it adds "Waking the server up… After a quiet spell this can
  take up to 30 seconds."
- It is plain CSS keyframes (`appear`, `tile-pop` in `globals.css`), so the
  app adds no library. Under reduced motion the tiles stand still.
- It's on the dashboard, Payments, Insights, Tenants, Sites, the grid, room
  setup, the tenant page, the tenant portal and the sign-in check.
- Pending keeps its per-section bars, because two loaders on one screen would
  be odd.
- A refetch after a change never shows it: only a page's first load does.

**The lag the owner saw opening a site wasn't reproduced.** Timed on
production on 24 Oct, the grid took 0.24–0.47s warm, 0.24s after 6 minutes
idle, and 0.45s after 16 minutes idle (the first request then took 1.6s).
There was no 30-second cold start, perhaps because the hostel's own traffic
kept the instance up. If it happens again, note the time: Echo's logger
records each request's latency in Render's logs. The owner chose to stay on
Render's free plan. Public registration already wakes the server when it
fetches the hostel's name on open, so a tenant filling in the form is unlikely
to hit a cold submit.

No migration, frontend only. Tests: `owner/site-grid-first.test.ts` (6
tests), covering the Sites tab with one site and with two, a new site
opening on room setup, the headcount, email absent from three screens, and
the loader on a 7-second response but not on a warm one. Full suite: 189
e2e and 70 unit tests.

**Production, 24 Oct 2026: live.** PR #51 was merged as `617bc42`. Vercel
reported the production deploy successful, and the live dashboard's HTML
carries the loader ("Waking the server up…"). Frontend only, so Render had
nothing to deploy. A loader for taps between pages (`loading.tsx`) was
deferred; see `docs/BACKLOG.md`.

---

## Moving beds, and tenants who come back (Oct 2026)

Owner, 24 Oct 2026: "I cannot move a tenant from one room to another", and
someone who moved out and came back had no way back in.

**Move bed** (migration 014, `stay_moves`). It's on the tenant's stay card
and in the grid's bed drawer, and opens `MoveBedDialog`.
- **The stay carries on.** The deposit, payments, balance and rent day don't
  change. Only `stays.bed_id` changes, so the grid, dashboard and Payments
  needed nothing. The old bed is free straight away.
- **A row in `stay_moves`** (from bed, to bed, day) records each move. The
  stay card shows "Moved from Room 2 · 1L on 18 Oct 2026".
- **Insights' "By room" follows it.** Nights split by `roomSpans`. A rent
  payment counts to the room they were in on the day they paid: the bed the
  next move left, or the current one.
- **The rent question is the owner's own words** (reworked 26 Oct 2026, after
  she tried the first version on the demo and found it hard to predict). "Does
  the rent change?" defaults to No. Yes asks two things:
  - "From next month, rent is ₹___"
  - "This month, they pay": the old rent, the new rent, or an amount you agreed

  That covers all three of the owner's ways to settle a move: new rent from
  next month, the whole month's difference now, or an agreed amount now. A
  line under the questions (`RentSummary`) says what it will mean before
  saving, for example "This month (1 Oct – 31 Oct) is ₹9,000, and ₹8,500 of it
  is paid. ₹500 is due now. From 1 Nov, ₹9,500 a month." The server works
  that out (`POST /stays/:id/rent-preview`, `previewRent`), so it can't
  disagree with the tenant's page.
- **Underneath, it's still rent steps.** `planRent` turns the answers into a
  schedule: earlier cycles keep their rent, steps after next month are
  replaced, and a step repeating the one before is merged. `writeSchedule`
  saves it, and one step goes back to a flat rent with no rows.
- **Change rent asks the same two questions** (`POST /stays/:id/rent`, from
  today), which also covers a discount agreed up front. "A different date"
  (the old date picker) and "Entered it wrong at move-in?" stay as links.
- **The labels use this month's rent from the server, never
  `stays.rent_amount`.** That is the latest scheduled rent, and the first
  version called next month's rent "the old rent".
- **A second move on the same day corrects the first** instead of adding a
  line, and moving back to the morning's bed removes the move. The owner's
  demo had one tenant moved three times in a minute.
- **Move from the empty bed:** on the grid, picking someone who already lives
  here in an empty bed's drawer opens the move, fixed to that bed. It used to
  end in "tenant already has an active stay". Someone with a booking gets a
  pointer to their page.
- **The server refuses** a taken bed, the same bed, a stay that ended or has
  no bed yet, a date before move-in or before the last move, and a date in the
  future (the same day's slack as a payment date).
- **Swaps are out of scope**, at the owner's call.

**From the owner's second demo try (26 Oct):**
- **A plain move shows no money line.** "No, stays ₹8,500" (or "No change"
  when a rise is already set) is enough. A line about next month's scheduled
  rent read as if the move changed it.
- **The date error says the date:** "Their last move was on 26 Oct 2026.
  Pick that day or later." The same goes for move-in, and the date field's
  minimum is that day.
- **Fixed: a page left unscrollable after two overlays closed together.**
  Each overlay saved `body.overflow` on open and restored it on close. With
  the grid's drawer and Move bed open at once, the second saved "hidden", and
  closing both re-locked the page across navigation. The owner had seen this
  "before". `useOverlay` now counts locks and unlocks on the last close, and
  reads `onClose` through a ref so a re-render doesn't release and retake the
  lock.

**Start a new stay.** It's on the tenant page whenever nobody has an open stay
(and "Start a stay" on a tenant who never had one), and opens `NewStayDialog`.
That is Add tenant's "Their stay" card (moving in or booking, bed, terms, paid
today) without the person. It's a fresh stay with its own deposit; the owner
said "most likely new deposit, let's not overcomplicate". The tenant page's
`reloadStays` now reloads the ledgers too, so a new stay doesn't sit at
"Paid —".

**Add tenant notices a returning number.** "Same number as Ajayraja, already
on your books" links to their page. It's a warning, not a block. `phoneKey`
moved to `lib/phone.ts`, shared with the pending queue.

**Talked about, not built:** discounts. A price agreed in advance can already
be done with Change rent; letting owed money go belongs with the corrections
design. See `docs/BACKLOG.md` → "Discounts".

**Migration 014 is new rows only.** Existing stays have no moves and read as
before, so the live account needs no backfill. **Production migrates before
the merge.**

Tests:
- `owner/move-bed.test.ts` (9):
  - a move from the tenant page paying the new rent this month, with the
    summary checked (₹9,500 due)
  - the old rent this month, and an agreed amount
  - same-day corrections
  - a move from an empty bed, and from the grid keeping the rent
  - the server's refusals
  - a returning tenant's new stay, and the same-number warning
- `owner/change-rent.test.ts`: the new questions, "a different date", and a
  stay with a rise already scheduled.
- `rentplan_test.go`: the three answers on the owner's dates, a first-month
  move, merging, replacing later steps, a discount agreed up front, and
  validation.
- `moves_test.go`: `roomSpans`, and a move splitting October 17/14 between
  two rooms.

Full suite: 200 e2e and 70 unit tests, plus `go test ./...`.

**Production, 26 Oct 2026: live.** The owner ran migration 014 in his own
terminal before the merge. PR #52 was merged as `906cdfd`, and Vercel and
Render both reported success. Checked read-only:
- `/health` 200
- a tenant's stay list returns, which needs `stay_moves`, so the migration
  is confirmed
- `rent-preview` works out Ajayraja's rent (₹4,500 from 17 Oct, square)
- Insights, the dashboard, the grid, `/tenants/29` and `/sites/1/grid` all
  serve

---

## Vacating tiles say when (Oct 2026)

Owner, 26 Oct 2026, looking at five orange tiles on the grid: they said who
was vacating, not when. Now the tile says it, where the rent date would go
(`leavingChip`, `lib/due.ts`):
- "leaves 2 Nov", or "leaves today". Not "leaves tomorrow", which doesn't fit
  a tile at 375px or 768px; tomorrow is a date like any other.
- "notice given" when they've told you but named no date.
- "left 24 Oct?" on a purple tile once the date has passed, because nothing
  ends a stay by itself: the owner confirms they went.

What a vacating tenant owes still shows as an amount in red. Only the rent
date gives way, and the drawer still has it in full. No backend change: the
grid already sent `expected_end_date`.

The bed panel says the rest (owner, trying it on the demo): a tinted line
above the balance, "Gave notice 6 Oct 2026 · leaving 30 Oct 2026, in 4
days", purple once the date has passed. It is the dashboard's Vacating Soon
sentence, moved from the dashboard to `departureFacts` (`lib/due.ts`) so the
two say it the same way, and both now add "in 4 days" or "today".

### Verification
- `tests/unit/due.test.ts`: each tile wording, and that a tenant with a
  far-off date and no notice gets none; each `departureFacts` sentence.
- `tests/e2e/owner/vacating-tiles.test.ts`: the three wordings and the owed
  amount on one grid, at 375×812, 768×1024 and 1024×768 under touch, that
  no line is cut off, and the panel's sentence for an upcoming and a passed
  date.

**Production, 26 Oct 2026: live.** Merged as `09f776b` after the owner tried
it on the demo. Frontend only, so nothing to migrate.

---

## A leaving date when someone moves in (Oct 2026)

Owner, 26 Oct 2026, raised again from 23 Oct: a guest for five nights, or
someone here for a month, says so at the door, but the date could only be
set afterwards on the tenant page. So a daily guest who had paid for the
whole stay showed as owing every morning.

- **"+ Leaving date, if known"** under the start date in `StayTermsFields`,
  folded away until tapped, so the form is no longer for the open-ended
  stays that are most of them. "No leaving date" folds it back. Being in
  `StayForm.tsx`, it reaches all four forms: Add tenant, the grid's assign
  drawer, the pending drawer and New stay.
- **Priced per night** (the owner's answer to the write-up's open question).
  For a daily stay the field says "5 nights", and Paid today's rent becomes
  the whole stay: "Rent · 5 nights (₹)", ₹500 × 5 = ₹2,500, still editable.
  The leaving day is not a night, which is the backend's count too
  (`cyclesThroughEnd`). `stayNights` and `rentForNights` in `lib/rent.ts`.
  Weekly and monthly stays keep one period in Paid today.
- **`POST /api/stays` takes `expected_end_date`**, which must come after
  `start_date`. It also sets `notice_date` to the start date: they told you
  on arrival. Without it the move-out sheet would say "no notice given" and
  keep the deposit by default.
- Nothing ends the stay on the day. As with any leaving date, a passed one
  turns the bed purple and asks the owner to confirm.

No native `min` on the date: it blocked submitting before the form's own
message could say why, and it allowed the start day itself, which the
server refuses.

### Verification
- `tests/unit/rent.test.ts`: nights across a month end, one night, a
  monthly stay, a date before arrival; ₹333.33 × 3 is ₹999.99.
- `tests/e2e/owner/leaving-date.test.ts` at 768×1024 under touch:
  - a five-night guest's Paid today follows the rate, records ₹2,500,
    saves both dates, and the bed is Vacating and owes nothing
  - the grid drawer's monthly stay keeps one month
  - a date before arrival shows the inline error, "No leaving date" saves an
    open stay
  - the API refuses a leaving date on the start day
- Screenshots of the form at 375, 768 and 1024.

**Production, 26 Oct 2026: live.** Merged as `2c3726d`, after #54. The full
suite passed on the two together (207 e2e, 74 unit, `go test ./...`). Vercel
and Render both reported success, and `/health`, the dashboard, Add tenant,
the grid and Insights all served. No migration: `expected_end_date` and
`notice_date` already existed.

---

## Insights says what its numbers mean (Oct 2026)

Owner, 27 Oct 2026, four board items about figures that were right and still
misread. He tried a first version on the demo and reworded it; this is the
second.

- **By room: "Occupied", not "Empty nights".** 168 empty bed-nights in a
  9-bed room was accurate and meant nothing. The column is now "1 of 2",
  counted the dashboard's way (an open stay in one of the room's beds), so
  the rooms add up to its occupied count. The owner asked for this and not
  rent missed or empty nights. `RoomInsight.occupied_now` replaces
  `vacant_nights`. The % column stays as "Occupancy", with an ⓘ in its
  heading that opens a small card: "How full the room was across these
  months, counting every night. 50% means that on an average night, half its
  beds were taken." (`InfoTip`, `components/ui`: drawn on the page body so a
  table that scrolls sideways cannot clip it, closed by a tap elsewhere, a
  scroll or Escape.) "Full today", "Average night" and a line under the
  table were tried first.
- **Rent collected's % is paid against billed, tenant by tenant.** The old
  "% of billed" pooled rent collected across tenants, so one tenant's advance
  made up for another's debt: "99% collected" beside ₹6,000 still owed. The
  tile now reads "₹10,76,900 billed in these months · 88% of it paid".
  `computePaidShare` lets each stay's rent credit pay its own oldest rent
  first, so an advance covers only its own tenant's later months, and the %
  is rounded down so it never says 100% while anyone owes. Each month's row
  keeps its collected %, under a line saying advances and late rent can take
  a month over or under 100%.
- **Still owed now says how many owe**: "16 of 22 tenants owe · chase them
  →" (`stays_open`, `stays_owing` on the dashboard's revenue, which already
  counted who owed). "6 of 22 paid up" was tried first; the owner preferred
  the number to chase. Not "pending", which the app uses for approvals.
- **Two occupancy figures, said together.** The tile was "Occupancy this
  month 61%" against the dashboard's "65% full today". It is now "Occupied
  today 21 of 32" with "66% today · 71% over October so far". The count is
  the dashboard's own, fetched, not recomputed. Always this month, by name,
  whatever the range, because a year's average beside today's count read as
  a new contradiction (demo: 33% vs 66%).
- **The dashboard's "expected" counts this month's leavers.** It summed open
  stays only, so after two people settled it read "₹75,000 of ₹69,500
  expected". `computeRevenue` now takes stays that ended this month too and
  bills them with `billedCycles`, Insights' own rule, so the tile equals
  Insights' row. Overdue still counts open stays only; a leaver who owes is
  on Payments.
- **The dashboard's Collected tile is rent only.** The "All money in: ₹X"
  line under it is gone (owner: the tile says Collected, so rent). Deposits
  and refunds are Insights → All money.

### Verification
- `go test ./internal/handlers`: `TestComputeRevenue_LeaverThisMonthStaysInExpected`
  (left on the 5th, left on their rent day, a daily guest across the month
  end, one still here, and the paid-up counts), `TestComputeRoomInsights_OccupiedNow`
  (a leaver, a move between rooms, a booking with no bed),
  `TestComputePaidShare_AnAdvanceCoversOnlyItsOwnTenant` (an advance, a
  debt, a leaver whose deposit paid part of their last month).
- `tests/e2e/owner/insights.test.ts`: "33% of it paid", "1 of 1 tenants
  owe", the Occupancy ⓘ opening and closing, "Occupied today", "1 of 1" and "0 of 1" by room, no Empty nights
  column, the dashboard's "of ₹23,000 expected" with two tenants who left on
  the 2nd, and no "All money in".
- Screenshots on the demo at 375, 768 and 1024.

---

## Help on demand, and a rent says what it is for (Oct 2026)

Owner, 27 Oct 2026, two board items. Opened as #57 and folded into #56 so the
two ship together.

- **Explanations wait behind an ⓘ.** The two notes in Record notice were
  right the first time and clutter every time after. `WithHelp`
  (`components/ui/WithHelp.tsx`) puts an ⓘ beside the heading, which shows
  the text on a tap, since the iPad has no hover. The dialog keeps "X is
  planning to leave." in view.
- **Delete tenant keeps one short line and a red button.** The owner tried
  the ⓘ there on the demo and wanted the warning back, shorter, before the
  button: "Only for a test entry or a duplicate. For someone who left, use
  Move out. Can't be undone." The button is red-outlined with a warning icon.
- **"₹500 a night", not "₹500/mo".** The grid's bed panel printed "/mo" for
  every stay, and the tenant page and Change rent printed "/monthly".
  `perCycle` (`lib/rent.ts`) says "a month", "a week" or "a night"
  everywhere, the portal and Move bed included. The grid now sends
  `rent_cycle`, and its `rent_amount` is the rent of the cycle billed now,
  not `stays.rent_amount`, which is the latest scheduled rent.

### Verification
- `tests/unit/rent.test.ts`: `perCycle`.
- `tests/e2e/owner/help-on-demand.test.ts` at 768×1024 under touch: the
  notice explanations shut until the ⓘ is tapped, the delete warning in view
  with no ⓘ, and the bed panel reads "Rent ₹500 a night" and "Rent ₹8,000 a
  month".
- `change-rent.test.ts` updated for "a month". `touch-targets.test.ts`
  passes with the ⓘ.
- Screenshots on the demo at 375 and 768.

---

## What people are told (Oct 2026)

Six board items about wording, from the owner's 27 Oct list:

- **The phone rule, said out loud.** "Enter a 10-digit mobile number" was
  the reply to 1234567899, which has ten digits. It is now "Enter a 10-digit
  mobile number starting with 6, 7, 8 or 9", in `lib/phone.ts` and
  `handlers/phone.go` alike, and on the tenant sign-in.
- **A tenant waiting for approval is told so.** Sign-in now tries records
  still waiting for approval too, after approved ones. If the password is
  right it answers 403 "The hostel hasn't approved your registration yet.
  You can sign in once they do." Only a right password learns that. A wrong
  one hears "That phone number and password don't match."
- **Public pages speak in sentences.** The registration link, the public
  register and upload endpoints, and the upload rate limit now reply in
  sentences, not "registration link not found". The register page and
  tenant sign-in go through `publicMessage` (`lib/publicError.ts`), which
  replaces a 500's note for the logs with "Something went wrong on our
  side" and a failed fetch with "Couldn't reach the hostel's server".
- **"72 characters or fewer" counted bytes.** bcrypt's limit is 72 bytes,
  so 25 Hindi letters were refused as too many characters. The message now
  says "up to 72 English letters, digits and symbols, or about 24 letters in
  Hindi or another script". The minimum counts letters, as a person does,
  on the server and the signup form.
- **Dates as dates on the tenant page.** "Notice 2026-08-01" is "Gave
  notice 1 Aug 2026"; the leaving badges, the stay's dates, the settlement
  and the ledger use `formatDay` too.
- **A new owner is welcomed, not welcomed back**: "Welcome" for a day after
  signing up, from the sign-up date, so the heading never changes on load.

### Verification
- `go test ./...`: `TestValidatePassword` with the new messages and a
  three-letter Hindi password under the minimum.
- `tests/e2e/public/messages.test.ts`: the approval message for a right
  password and the mismatch for a wrong one, sentences from the public API,
  the Hindi passphrase, 1234567899 on Add tenant, "Welcome," for a new
  owner, and no ISO date on a tenant page.
- Existing tests updated for the new phone and password wording.

---

## The registration form (Oct 2026)

Four board items about the QR registration form, from the owner's 27 Oct
list. ("A duplicate registration goes through silently" was dropped by his
choice: warning on the public form would tell any stranger that a number is
on the books, and approving already says "Same number as …".)

- **A wrong link says so.** The page asks for the hostel's name on load;
  a 404 now replaces the form with "This registration link doesn't work",
  instead of letting someone fill it in and fail after three photo uploads.
  A network failure leaves the form up, since the link may be fine.
- **Aadhaar takes digits.** The field drops anything but digits and spaces
  as it is typed, fits "1234 5678 9012", and the form checks for twelve
  digits before anything uploads. Public registration refuses anything else
  too (`validAadhaar`). The number is still kept as typed.
- **Each error sits at its field, with the focus** (UX audit M15). A bad
  phone, emergency phone or Aadhaar number shows under that field, which
  takes the focus, so the browser scrolls to the reason. `Input` now
  accepts a ref for this.
- **"Show password" on every password field**: owner sign-in and sign-up,
  registration, the tenant sign-in and signing in again after a session
  ends. `ShowPassword` (`components/ui`) is the checkbox the portal-password
  dialog and Account already had, now shared.

### Verification
- `go test ./internal/handlers`: `TestValidAadhaar`.
- `tests/e2e/public/registration-form.test.ts` at 375 under touch: the wrong
  link, letters dropped from Aadhaar, the error and focus at Aadhaar then at
  the phone, the API's 400, and Show password on all four pages.
- Tests that found the field by "Password" now anchor the label
  (`/^Password/`), since "Show password" contains it.

---

## Screens that answer (Oct 2026)

Four board items from the owner's 27 Oct list:

- **A loader between pages.** On weak mobile data a tap on a page not yet
  prefetched left the old page up with no sign. Now the tapped nav icon
  pulses from the tap (`NavIcon`, `useLinkStatus`), and
  `app/(dashboard)/loading.tsx` shows `PageLoader` while the page's code
  downloads. Measured on a throttled production build: the icon at 0.4 s,
  the loader at 2 s, the page at 4 s; before, nothing until the page. The
  dev server does not prefetch loading states, so the e2e suite cannot show
  this; it was checked by hand against `next build`.
- **The Pending badge counts proofs and keeps up.** It counted registrations
  only, so a tenant's payment proof could sit unseen, and it refreshed only
  on navigation. It now adds waiting proofs, and the Pending page announces
  every approve and reject (`pendingChanged`, `lib/pending.ts`) so the
  badge follows without a reload.
- **Approving a payment proof asks first**, as rejecting did: "Approve
  ₹5,000 from Priya? It counts as paid on their ledger straight away."
  No screen takes an approval back.
- **A friendly 404, and missing records said.** `app/not-found.tsx` replaces
  the framework's bare 404. A tenant or site that is not there (deleted, or
  another account's link) shows "This tenant isn't on your books" on its
  own URL instead of bouncing to the list; a load that failed offers "Try
  again". `NotFound` in `components/ui`.

### Verification
- `tests/e2e/owner/screens-feedback.test.ts` at 1024×768 under touch: the
  unknown page, tenant and site; the badge at 2 with a registration and a
  proof, the approval's confirm, and the badge at 1 on the same page.
- The loader: the throttled production measurement above.

---

## Architecture Notes

- **Amounts**: stored in paise (1 INR = 100 paise), displayed via `formatCurrency()`
- **Multi-tenancy**: every query filters by `owner_id`; bed/room ownership verified by joining up the chain (bed → room → site → owner)
- **Active stay**: `stays WHERE end_date IS NULL` — only one allowed per bed (enforced at API level)
- **Token storage**: JWT in `localStorage` (client-side only); future consideration: httpOnly cookie
- **DB migrations**: managed via `golang-migrate` CLI (`make migrate`)
